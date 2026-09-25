// Estado em memoria do portal: janela deslizante de eventos VES, lista de alarmes
// correntes, series temporais por dominio e assinantes SSE.
//
// Nao ha banco de dados: o portal e uma camada de apresentacao sobre os
// componentes oficiais do SMO, e todo dado persistente vive neles (SDN-R/MariaDB
// para inventario, Kafka para o fluxo de eventos).

import { EventEmitter } from 'node:events';
import { config } from './config.js';

const BUCKET_MS = 60_000; // granularidade das series temporais: 1 minuto

class Store extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.events = [];       // eventos VES recentes (mais novo primeiro)
    this.alarms = new Map(); // chave: fonte|nomeAlarme -> alarme corrente
    this.series = new Map(); // dominio -> Map(bucketTs -> contagem)
    this.nfState = new Map(); // nome da NF -> ultimo visto, contadores
    this.kpis = new Map();   // "nf::kpi" -> { nf, name, unit, points: [{t, v}] }
    this.counters = { total: 0, byDomain: {} };
    this.kafkaConnected = false;
    this.startedAt = Date.now();
  }

  // --------------------------------------------------------------- ingestao

  ingest(domain, raw) {
    const evt = normalize(domain, raw);
    this.events.unshift(evt);
    if (this.events.length > config.retention.maxEvents) {
      this.events.length = config.retention.maxEvents;
    }

    this.counters.total += 1;
    this.counters.byDomain[evt.domain] = (this.counters.byDomain[evt.domain] || 0) + 1;

    this.#bump(evt.domain, evt.timestamp);
    this.#touchNf(evt);

    if (evt.domain === 'fault' || evt.domain === 'fault3gpp') this.#applyFault(evt);
    // Qualquer evento que carregue medicoes numericas alimenta as series de KPI,
    // independentemente do dominio declarado no cabecalho VES.
    if (evt.kpis?.length) this.#applyKpis(evt);

    this.emit('event', evt);
    return evt;
  }

  #bump(domain, ts) {
    const bucket = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
    if (!this.series.has(domain)) this.series.set(domain, new Map());
    const s = this.series.get(domain);
    s.set(bucket, (s.get(bucket) || 0) + 1);

    const cutoff = Date.now() - config.retention.seriesMinutes * BUCKET_MS;
    for (const key of s.keys()) if (key < cutoff) s.delete(key);
  }

  #touchNf(evt) {
    const name = evt.source;
    if (!name) return;
    const cur = this.nfState.get(name) || { name, firstSeen: evt.timestamp, events: 0, domains: {} };
    cur.lastSeen = evt.timestamp;
    cur.events += 1;
    cur.domains[evt.domain] = (cur.domains[evt.domain] || 0) + 1;
    if (evt.domain === 'heartbeat') cur.lastHeartbeat = evt.timestamp;
    if (evt.domain === 'pnfRegistration') cur.registeredAt = evt.timestamp;
    this.nfState.set(name, cur);
  }

  #applyFault(evt) {
    const f = evt.fault;
    if (!f || !f.alarmCondition) return;
    const key = `${evt.source}|${f.alarmCondition}`;
    const cleared = String(f.eventSeverity).toUpperCase() === 'NORMAL';

    if (cleared) {
      const existing = this.alarms.get(key);
      if (existing) {
        existing.status = 'cleared';
        existing.clearedAt = evt.timestamp;
        existing.severity = 'NORMAL';
      }
      return;
    }

    const existing = this.alarms.get(key);
    if (existing && existing.status === 'active') {
      existing.count += 1;
      existing.lastSeen = evt.timestamp;
      existing.severity = f.eventSeverity;
      return;
    }

    this.alarms.set(key, {
      key,
      source: evt.source,
      condition: f.alarmCondition,
      specificProblem: f.specificProblem || f.alarmCondition,
      severity: f.eventSeverity || 'UNKNOWN',
      eventName: evt.name,
      status: 'active',
      raisedAt: evt.timestamp,
      lastSeen: evt.timestamp,
      count: 1,
      acknowledged: false,
    });

    // Evita crescimento ilimitado: descarta os alarmes limpos mais antigos.
    if (this.alarms.size > config.retention.maxAlarms) {
      const sorted = [...this.alarms.values()].sort((a, b) => a.lastSeen - b.lastSeen);
      for (const a of sorted) {
        if (this.alarms.size <= config.retention.maxAlarms) break;
        if (a.status === 'cleared') this.alarms.delete(a.key);
      }
    }
  }

  #applyKpis(evt) {
    for (const kpi of evt.kpis || []) {
      const key = `${evt.source}::${kpi.name}`;
      if (!this.kpis.has(key)) {
        this.kpis.set(key, { key, nf: evt.source, name: kpi.name, unit: kpi.unit || '', points: [] });
      }
      const entry = this.kpis.get(key);
      entry.unit = kpi.unit || entry.unit;
      entry.points.push({ t: evt.timestamp, v: kpi.value });
      if (entry.points.length > 240) entry.points.splice(0, entry.points.length - 240);
    }
  }

  // ----------------------------------------------------------------- leitura

  snapshot() {
    return {
      uptimeMs: Date.now() - this.startedAt,
      kafkaConnected: this.kafkaConnected,
      counters: this.counters,
      alarms: this.alarmSummary(),
      nf: [...this.nfState.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  alarmSummary() {
    const out = { critical: 0, major: 0, minor: 0, warning: 0, active: 0, cleared: 0, total: this.alarms.size };
    for (const a of this.alarms.values()) {
      if (a.status === 'active') {
        out.active += 1;
        const sev = String(a.severity).toLowerCase();
        if (sev in out) out[sev] += 1;
      } else {
        out.cleared += 1;
      }
    }
    return out;
  }

  listAlarms({ status, limit = 200 } = {}) {
    let list = [...this.alarms.values()];
    if (status && status !== 'all') list = list.filter((a) => a.status === status);
    return list.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
  }

  listEvents({ domain, source, limit = 100 } = {}) {
    let list = this.events;
    if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
    if (source) list = list.filter((e) => e.source === source);
    return list.slice(0, limit);
  }

  seriesFor(minutes = 30) {
    const now = Date.now();
    const start = Math.floor((now - minutes * BUCKET_MS) / BUCKET_MS) * BUCKET_MS;
    const buckets = [];
    for (let t = start; t <= now; t += BUCKET_MS) buckets.push(t);

    const domains = [...this.series.keys()].sort();
    return {
      buckets,
      domains: domains.map((d) => ({
        domain: d,
        values: buckets.map((t) => this.series.get(d).get(t) || 0),
      })),
    };
  }

  listKpis() {
    return [...this.kpis.values()]
      .map((k) => ({
        ...k,
        latest: k.points.length ? k.points[k.points.length - 1].v : null,
        points: k.points.slice(-120),
      }))
      .sort((a, b) => a.nf.localeCompare(b.nf) || a.name.localeCompare(b.name));
  }

  acknowledge(key) {
    const a = this.alarms.get(key);
    if (!a) return null;
    a.acknowledged = true;
    a.acknowledgedAt = Date.now();
    this.emit('alarm', a);
    return a;
  }
}

// ---------------------------------------------------------------- normalizacao

// Converte um evento VES bruto (Common Event Format) numa forma compacta e
// estavel para a UI, preservando o evento original para inspecao.
function normalize(domain, raw) {
  const event = raw?.event || raw || {};
  const header = event.commonEventHeader || {};

  const timestamp = header.lastEpochMicrosec
    ? Math.floor(header.lastEpochMicrosec / 1000)
    : Date.now();

  // O PM streaming do O-RAN SC chega com domain "stndDefined" no cabecalho; o
  // topico de origem e mais informativo para a UI.
  const dominioCabecalho = header.domain || domain;
  const dominio = dominioCabecalho === 'stndDefined' && domain === 'pmStreaming' ? 'pmStreaming' : dominioCabecalho;

  const evt = {
    id: `${header.eventId || 'evt'}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    domain: dominio,
    name: header.eventName || domain,
    source: header.sourceName || header.reportingEntityName || 'desconhecido',
    priority: header.priority || 'Normal',
    sequence: header.sequence ?? null,
    timestamp,
    raw,
  };

  if (event.faultFields) {
    evt.fault = {
      alarmCondition: event.faultFields.alarmCondition,
      specificProblem: event.faultFields.specificProblem,
      eventSeverity: event.faultFields.eventSeverity,
      eventSourceType: event.faultFields.eventSourceType,
      vfStatus: event.faultFields.vfStatus,
    };
  }

  const kpis = [];
  const mf = event.measurementFields || event.measurementsForVfScalingFields;
  if (mf) {
    for (const item of mf.additionalMeasurements || []) {
      for (const [k, v] of Object.entries(item.hashMap || {})) {
        const num = Number(v);
        if (Number.isFinite(num)) kpis.push({ name: `${item.name}.${k}`, value: num });
      }
    }
    for (const [k, v] of Object.entries(mf.additionalFields || {})) {
      const num = Number(v);
      if (Number.isFinite(num)) kpis.push({ name: k, value: num });
    }
  }

  // Formato experimental de PM streaming do O-RAN SC
  // (o-ran-sc-du-hello-world-pm-streaming-oas3).
  const sd = event.stndDefinedFields?.data;
  if (sd?.measurements) {
    for (const m of sd.measurements) {
      const num = Number(m.value ?? m.measurementValue);
      if (!Number.isFinite(num)) continue;
      const ref = m['measurement-type-instance-reference'] || m.measurementTypeInstanceReference || m.name;
      kpis.push({ name: measurementLabel(ref), value: num, unit: m.unit });
    }
  }
  if (kpis.length) evt.kpis = kpis;

  return evt;
}

// O instance-identifier de uma medicao e um xPath YANG completo, longo demais
// para um titulo de grafico. Extrai o tipo da medicao e a celula a que se refere.
function measurementLabel(reference) {
  if (typeof reference !== 'string') return 'medição';

  const tipo = reference.match(/performance-measurement-type='(?:[^:']+:)?([^']+)'/)?.[1];
  const celula = reference.match(/cell\[id='([^']+)'\]/)?.[1];
  if (!tipo) return reference;

  const legivel = tipo.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return celula ? `${legivel} · ${celula}` : legivel;
}

export const store = new Store();
