// Portal de operacao do SMO.
//
// O portal nao implementa funcoes de SMO: ele consome as APIs dos componentes
// oficiais da O-RAN Software Community (SDN-R via RESTCONF, VES Collector via
// Kafka, Non-RT RIC via A1 Policy Management Service) e as apresenta numa unica
// interface de operacao.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config } from './config.js';
import { store } from './store.js';
import { sdnr } from './sdnr.js';
import { a1 } from './a1.js';
import { lcm } from './lcm.js';
import { provisioning } from './provisioning.js';
import { suggestionsFor, invalidateSuggestions } from './suggestions.js';
import { startKafkaConsumer } from './kafka.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------- saude

// Identificador desta instancia do portal. Muda a cada reinicio do processo,
// o que permite ao navegador perceber que ha codigo novo servido e recarregar
// em vez de continuar executando os modulos que ja tem em cache.
const BUILD_ID = `${store.startedAt.toString(36)}`;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'up', uptimeMs: Date.now() - store.startedAt, kafka: store.kafkaConnected, buildId: BUILD_ID });
});

app.get('/api/config', (_req, res) => {
  res.json({ links: config.links, managedNf: config.managedNf, buildId: BUILD_ID });
});

// Estado consolidado de todos os componentes da solucao.
app.get('/api/overview', async (_req, res) => {
  const [controllerReady, nodes, inventory, a1Status] = await Promise.all([
    sdnr.ready(),
    sdnr.nodes(),
    lcm.inventory(),
    a1.status(),
  ]);

  const snap = store.snapshot();
  const connected = nodes.nodes.filter((n) => String(n.status).toLowerCase() === 'connected').length;

  res.json({
    ...snap,
    controller: { ready: controllerReady, reachable: nodes.ok },
    a1: { available: a1Status.available },
    topology: { total: nodes.nodes.length, connected, nodes: nodes.nodes },
    inventory,
    series: store.seriesFor(30),
  });
});

// ------------------------------------------------------- inventario / interface O1

app.get('/api/nodes', async (_req, res) => {
  res.json(await sdnr.nodes());
});

app.get('/api/nodes/:id', async (req, res) => {
  res.json(await sdnr.node(req.params.id));
});

app.get('/api/nodes/:id/config', async (req, res) => {
  const { path: yangPath, datastore } = req.query;
  if (!yangPath) return res.status(400).json({ ok: false, error: 'parametro "path" obrigatorio' });
  res.json(await sdnr.readMount(req.params.id, yangPath, datastore || 'config'));
});

app.put('/api/nodes/:id/config', async (req, res) => {
  const { path: yangPath, payload } = req.body || {};
  if (!yangPath) return res.status(400).json({ ok: false, error: 'campo "path" obrigatorio' });

  const write = await sdnr.writeMount(req.params.id, yangPath, payload);
  // Le de volta para evidenciar que o edit-config foi aplicado no elemento.
  const verify = write.ok ? await sdnr.readMount(req.params.id, yangPath, 'config') : null;
  // Uma escrita pode criar um ramo antes vazio; a sondagem precisa ser refeita.
  if (write.ok) invalidateSuggestions(req.params.id);
  res.json({ write, verify });
});

// Caminhos de configuracao sondados no proprio elemento.
app.get('/api/nodes/:id/suggestions', async (req, res) => {
  res.json({ suggestions: await suggestionsFor(req.params.id) });
});

// Perfil de provisionamento inicial aplicado pelo SMO a cada funcao de rede.
app.get('/api/provisioning/baseline', (_req, res) => {
  res.json({ baseline: provisioning.baseline, status: provisioning.status() });
});

app.post('/api/provisioning/baseline/:id', async (req, res) => {
  res.json(await provisioning.apply(req.params.id, { force: true }));
});

app.post('/api/nodes/:id/mount', async (req, res) => {
  const { host, port, username, password } = req.body || {};
  res.json(await sdnr.mountNode(req.params.id, {
    host: host || req.params.id,
    port: port || 830,
    username: username || 'netconf',
    password: password || 'netconf!',
  }));
});

app.delete('/api/nodes/:id/mount', async (req, res) => {
  res.json(await sdnr.unmountNode(req.params.id));
});

// -------------------------------------------------------- falhas e desempenho

app.get('/api/alarms', (req, res) => {
  res.json({
    summary: store.alarmSummary(),
    alarms: store.listAlarms({ status: req.query.status, limit: Number(req.query.limit) || 200 }),
  });
});

app.post('/api/alarms/:key/ack', (req, res) => {
  const alarm = store.acknowledge(decodeURIComponent(req.params.key));
  if (!alarm) return res.status(404).json({ ok: false, error: 'alarme nao encontrado' });
  res.json({ ok: true, alarm });
});

app.get('/api/events', (req, res) => {
  res.json({
    events: store.listEvents({
      domain: req.query.domain,
      source: req.query.source,
      limit: Number(req.query.limit) || 100,
    }),
  });
});

app.get('/api/performance', (req, res) => {
  res.json({
    series: store.seriesFor(Number(req.query.minutes) || 60),
    kpis: store.listKpis(),
    counters: store.counters,
    nf: [...store.nfState.values()],
  });
});

// ------------------------------------------------------------- politicas A1

app.get('/api/a1/overview', async (_req, res) => {
  const status = await a1.status();
  if (!status.available) {
    return res.json({ available: false, hint: 'Perfil "a1" nao esta ativo. Suba com: docker compose --profile a1 up -d' });
  }

  const [rics, instancias, types] = await Promise.all([a1.rics(), a1.policies(), a1.policyTypes()]);

  // As instancias ja vem completas; so o estado de aplicacao exige uma consulta
  // por politica, porque o PMS o busca no proprio RIC.
  const policies = await Promise.all((instancias.policies || []).map(async (definition) => ({
    id: definition.policy_id,
    definition,
    status: await a1.policyStatus(definition.policy_id),
  })));

  res.json({ available: true, rics: rics.rics, types: types.types, policies });
});

app.get('/api/a1/policy-types/:id', async (req, res) => {
  res.json(await a1.policyTypeSchema(req.params.id));
});

app.post('/api/a1/policies', async (req, res) => {
  res.json(await a1.createPolicy(req.body || {}));
});

app.delete('/api/a1/policies/:id', async (req, res) => {
  res.json(await a1.deletePolicy(req.params.id));
});

app.post('/api/a1/seed-type', async (req, res) => {
  const { typeId, schema } = req.body || {};
  if (!typeId || !schema) return res.status(400).json({ ok: false, error: 'campos "typeId" e "schema" obrigatorios' });
  res.json(await a1.ensurePolicyType(typeId, schema));
});

app.get('/api/a1/ric/policy-types', async (_req, res) => {
  res.json(await a1.ricPolicyTypes());
});

// ---------------------------------------------------- ciclo de vida das NFs

app.get('/api/lifecycle', async (_req, res) => {
  res.json(await lcm.inventory());
});

app.post('/api/lifecycle/:name/:action', async (req, res) => {
  const result = await lcm.action(req.params.name, req.params.action);
  res.status(result.ok ? 200 : result.status || 500).json(result);
});

app.get('/api/lifecycle/:name/logs', async (req, res) => {
  res.json(await lcm.logs(req.params.name, Number(req.query.tail) || 200));
});

// ------------------------------------------------------- fluxo de eventos (SSE)

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': conectado ao fluxo de eventos do SMO\n\n');

  const send = (type, payload) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onEvent = (evt) => send('ves', { ...evt, raw: undefined });
  const onAlarm = (alarm) => send('alarm', alarm);
  store.on('event', onEvent);
  store.on('alarm', onAlarm);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    store.off('event', onEvent);
    store.off('alarm', onAlarm);
  });
});

// ----------------------------------------------------------------- frontend

// O frontend nao tem etapa de compilacao nem nomes versionados, entao os
// modulos precisam ser revalidados a cada carga: sem isso o navegador continua
// executando a versao anterior depois de um novo build do portal.
app.use(express.static(path.join(__dirname, '..', 'web'), {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders: (res, caminho) => {
    // A casca da SPA nunca e armazenada; os modulos sao sempre revalidados.
    res.setHeader('Cache-Control', caminho.endsWith('.html') ? 'no-store' : 'no-cache');
  },
}));

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// ------------------------------------------------------------------- startup

app.listen(config.port, () => {
  console.log(`[portal] escutando em http://0.0.0.0:${config.port}`);
  console.log(`[portal] SDN-R: ${config.sdnc.baseUrl}`);
  console.log(`[portal] Kafka: ${config.kafka.brokers.join(',')}`);
  console.log(`[portal] A1 PMS: ${config.a1.pmsBaseUrl}`);
});

startKafkaConsumer().catch((err) => {
  console.error('[kafka] falha ao iniciar consumidor:', err.message);
});

// Reconciliador de provisionamento: garante que toda funcao de rede conectada
// receba o perfil inicial pela interface O1.
provisioning.start();
