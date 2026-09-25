// Desempenho e telemetria: vazao de eventos VES por dominio, indicadores
// extraidos dos eventos de medicao e atividade por funcao de rede.

import {
  el, api, card, table, badge, emptyState, clear,
  fmtInt, fmtNum, fmtAgo, fmtTime, domainLabel, seriesColor,
} from '../ui.js';
import { stackedBars, timeSeries, horizontalBars, legend, onResize } from '../charts.js';

export async function render(root, ctx) {
  let minutes = 60;
  let data = await api(`/performance?minutes=${minutes}`);
  clear(root);

  const throughputBox = el('div');
  const throughputLegend = el('div');
  const byNfBox = el('div');
  const kpiBox = el('div', { class: 'stack' });
  const eventsBox = el('div');

  // ------------------------------------------------- vazao de eventos VES
  function drawThroughput() {
    const domains = data.series.domains.filter((d) => d.values.some((v) => v > 0));
    if (!domains.length) {
      clear(throughputBox).append(emptyState('Sem eventos na janela', 'A telemetria aparece assim que as funções de rede começam a reportar.'));
      clear(throughputLegend);
      return;
    }
    const labels = data.series.buckets.map((t) => fmtTime(t).slice(0, 5));
    const series = domains.map((d, i) => ({ name: domainLabel(d.domain), color: seriesColor(i), values: d.values }));
    stackedBars(throughputBox, { labels, series, height: 230, tooltipTitle: (l) => `${l} — eventos por minuto` });
    clear(throughputLegend).append(legend(series.map((s) => ({ label: s.name, color: s.color }))));
  }

  const rangeButtons = el('div', { class: 'card-head-actions' },
    [15, 30, 60].map((m) => {
      const b = el('button', { class: `btn btn-sm${m === minutes ? ' btn-primary' : ''}`, type: 'button', text: `${m} min` });
      b.addEventListener('click', async () => {
        minutes = m;
        for (const child of b.parentElement.children) child.className = 'btn btn-sm';
        b.className = 'btn btn-sm btn-primary';
        await reload();
      });
      return b;
    }));

  // ------------------------------------------------- distribuicao por NF
  function drawByNf() {
    const items = (data.nf || [])
      .filter((n) => n.events > 0)
      .sort((a, b) => b.events - a.events)
      .slice(0, 8)
      .map((n, i) => ({ label: n.name, value: n.events, color: seriesColor(i), tooltipLabel: 'Eventos recebidos' }));

    if (!items.length) {
      clear(byNfBox).append(emptyState('Sem eventos por elemento'));
      return;
    }
    horizontalBars(byNfBox, { items });
  }

  // ------------------------------------------------------- indicadores (KPI)
  function drawKpis() {
    clear(kpiBox);
    const kpis = (data.kpis || []).filter((k) => k.points.length >= 2);

    if (!kpis.length) {
      kpiBox.append(card({
        title: 'Indicadores de desempenho',
        subtitle: 'Séries extraídas dos eventos VES de medição',
        body: emptyState(
          'Nenhum indicador numérico recebido ainda',
          'Os simuladores publicam medições periodicamente; a primeira série costuma aparecer alguns minutos após a subida.',
        ),
      }));
      return;
    }

    for (const kpi of kpis.slice(0, 8)) {
      const box = el('div');
      kpiBox.append(card({
        title: kpi.name,
        subtitle: `${kpi.nf} · ${kpi.points.length} amostras`,
        actions: [badge(`${fmtNum(kpi.latest)}${kpi.unit ? ` ${kpi.unit}` : ''}`, 'neutral')],
        body: box,
      }));
      timeSeries(box, { points: kpi.points, unit: kpi.unit, label: kpi.name, color: 'var(--series-1)' });
    }
  }

  // -------------------------------------------------------- eventos recentes
  async function drawEvents() {
    const res = await api('/events?limit=40');
    clear(eventsBox);
    if (!res.events.length) {
      eventsBox.append(emptyState('Nenhum evento recebido'));
      return;
    }
    eventsBox.append(table([
      { label: 'Horário', render: (e) => el('span', { style: 'white-space:nowrap', text: fmtTime(e.timestamp) }) },
      { label: 'Domínio', render: (e) => badge(domainLabel(e.domain), 'neutral') },
      { label: 'Elemento', render: (e) => el('span', { style: 'font-weight:600', text: e.source }) },
      { label: 'Evento', mono: true, key: 'name' },
    ], res.events));
  }

  async function reload() {
    try {
      data = await api(`/performance?minutes=${minutes}`);
      drawThroughput(); drawByNf(); drawKpis(); await drawEvents();
    } catch { /* mantem a ultima leitura valida */ }
  }

  // ------------------------------------------------------------------ layout
  root.append(card({
    title: 'Vazão de eventos da interface O1',
    subtitle: 'Eventos VES por minuto, empilhados por domínio',
    actions: [rangeButtons],
    body: el('div', {}, [throughputBox, throughputLegend]),
  }));
  drawThroughput();

  root.append(el('div', { style: 'height:16px' }));

  root.append(el('div', { class: 'grid grid-2' }, [
    card({
      title: 'Atividade por função de rede',
      subtitle: 'Total de eventos recebidos de cada elemento',
      body: byNfBox,
    }),
    card({
      title: 'Estado de reporte',
      subtitle: 'Último evento recebido de cada elemento',
      body: (data.nf || []).length
        ? table([
            { label: 'Elemento', render: (n) => el('span', { style: 'font-weight:600', text: n.name }) },
            { label: 'Último heartbeat', render: (n) => n.lastHeartbeat
              ? el('span', { style: 'font-size:12.5px', text: fmtAgo(n.lastHeartbeat) })
              : badge('sem heartbeat', 'warning', 'warning') },
            { label: 'Eventos', align: 'right', render: (n) => fmtInt(n.events) },
          ], [...data.nf].sort((a, b) => a.name.localeCompare(b.name)))
        : emptyState('Nenhum elemento reportando'),
    }),
  ]));

  root.append(el('div', { style: 'height:16px' }));
  drawByNf();

  root.append(kpiBox);
  drawKpis();

  root.append(el('div', { style: 'height:16px' }));
  root.append(card({
    title: 'Eventos recentes',
    subtitle: 'Últimos eventos VES recebidos pelo barramento do SMO',
    body: eventsBox,
  }));
  await drawEvents();

  let pending = 0;
  const unsubscribe = ctx.subscribe((type) => {
    if (type !== 'ves') return;
    pending += 1;
    if (pending % 20 === 0) reload();
  });
  const timer = setInterval(reload, 20000);
  const offResize = onResize(() => { drawThroughput(); drawByNf(); drawKpis(); });

  return () => { clearInterval(timer); unsubscribe(); offResize(); };
}
