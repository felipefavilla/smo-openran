// Visao geral: estado consolidado da plataforma SMO, da rede gerenciada e do
// fluxo de eventos da interface O1.

import {
  el, api, card, tile, table, badge, emptyState, clear,
  fmtInt, fmtDuration, fmtAgo, domainLabel, seriesColor, statusIcon,
} from '../ui.js';
import { stackedBars, legend, onResize } from '../charts.js';
import { topologyDiagram } from './topology.js';

export async function render(root, ctx) {
  const data = await api('/overview');
  clear(root);

  const connected = data.topology.connected;
  const totalNodes = data.topology.total;
  const alarms = data.alarms;
  ctx.setFaultBadge(alarms.active);

  // ------------------------------------------------------------ indicadores
  root.append(el('div', { class: 'grid grid-tiles', style: 'margin-bottom:16px' }, [
    tile({
      label: 'Funções de rede conectadas',
      value: `${connected}/${totalNodes || '0'}`,
      tone: totalNodes && connected === totalNodes ? 'good' : connected === 0 ? 'critical' : null,
      meta: [statusIcon(connected === totalNodes && totalNodes ? 'good' : 'warning'), 'via NETCONF (interface O1)'],
    }),
    tile({
      label: 'Alarmes ativos',
      value: fmtInt(alarms.active),
      tone: alarms.critical > 0 ? 'critical' : alarms.active === 0 ? 'good' : null,
      meta: alarms.critical > 0
        ? [statusIcon('critical'), `${alarms.critical} crítico(s)`]
        : [statusIcon('good'), 'nenhum alarme crítico'],
    }),
    tile({
      label: 'Eventos VES recebidos',
      value: fmtInt(data.counters.total),
      meta: [data.kafkaConnected ? statusIcon('good') : statusIcon('critical'),
        data.kafkaConnected ? 'barramento Kafka conectado' : 'barramento indisponível'],
    }),
    tile({
      label: 'Tempo de operação do portal',
      value: fmtDuration(data.uptimeMs),
      meta: [statusIcon(data.controller.ready ? 'good' : 'warning'),
        data.controller.ready ? 'SDN-R operacional' : 'SDN-R indisponível'],
    }),
  ]));

  // ---------------------------------------------------- fluxo de eventos VES
  const chartBox = el('div');
  const legendBox = el('div');

  const domains = data.series.domains.filter((d) => d.values.some((v) => v > 0));
  const drawSeries = () => {
    if (!domains.length) {
      clear(chartBox).append(emptyState(
        'Ainda não há eventos no barramento',
        'Os eventos aparecem assim que as funções de rede iniciam o registro e os heartbeats.',
      ));
      clear(legendBox);
      return;
    }
    const labels = data.series.buckets.map((t) =>
      new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    const series = domains.map((d, i) => ({ name: domainLabel(d.domain), color: seriesColor(i), values: d.values }));

    stackedBars(chartBox, {
      labels,
      series,
      height: 220,
      tooltipTitle: (label) => `${label} — eventos por minuto`,
    });
    clear(legendBox).append(legend(series.map((s) => ({ label: s.name, color: s.color }))));
  };
  drawSeries();

  root.append(card({
    title: 'Fluxo de eventos da interface O1',
    subtitle: 'Eventos VES por minuto, segregados por domínio, nos últimos 30 minutos',
    body: el('div', {}, [chartBox, legendBox]),
  }));

  // ---------------------------------------------------------------- topologia
  root.append(el('div', { style: 'height:16px' }));
  root.append(card({
    title: 'Topologia gerenciada',
    subtitle: 'Relação entre o SMO e os elementos da pilha Open RAN',
    body: topologyDiagram(data.topology.nodes, { a1Available: data.a1.available }),
  }));

  // ------------------------------------------------------- saude da plataforma
  root.append(el('div', { style: 'height:16px' }));

  const platform = (data.inventory.platform || []).filter((s) => s.present);
  root.append(el('div', { class: 'grid grid-2' }, [
    card({
      title: 'Componentes da plataforma SMO',
      subtitle: 'Serviços oficiais da O-RAN Software Community em execução',
      body: platform.length
        ? table([
            { label: 'Componente', key: 'name', render: (r) => el('span', {}, [
              el('div', { style: 'font-weight:600', text: r.name }),
              el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: r.description || r.role }),
            ]) },
            { label: 'Estado', render: (r) => componentBadge(r) },
          ], platform)
        : emptyState('Sem informação de plataforma', 'O portal não conseguiu falar com a Docker Engine API.'),
    }),
    card({
      title: 'Funções de rede',
      subtitle: 'Elementos da pilha Open RAN sob gestão do SMO',
      body: (data.inventory.nf || []).length
        ? table([
            { label: 'Função', key: 'name', render: (r) => el('span', {}, [
              el('div', { style: 'font-weight:600', text: r.name }),
              el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: r.description || '' }),
            ]) },
            { label: 'Contêiner', render: (r) => componentBadge(r) },
            { label: 'NETCONF', render: (r) => netconfBadge(data.topology.nodes, r.name) },
            { label: 'Último evento', render: (r) => {
              const nf = data.nf.find((n) => n.name === r.name);
              return el('span', { style: 'font-size:12px;color:var(--text-secondary)', text: nf ? fmtAgo(nf.lastSeen) : '—' });
            } },
          ], data.inventory.nf)
        : emptyState('Nenhuma função de rede declarada'),
    }),
  ]));

  // --------------------------------------------------- atualizacao ao vivo
  let pending = 0;
  const unsubscribe = ctx.subscribe((type) => {
    if (type !== 'ves') return;
    pending += 1;
    if (pending % 25 === 0) refresh();
  });

  const timer = setInterval(refresh, 15000);
  const offResize = onResize(drawSeries);

  async function refresh() {
    try {
      const fresh = await api('/overview');
      if (document.getElementById('conteudo').contains(chartBox)) {
        Object.assign(data, fresh);
        domains.length = 0;
        domains.push(...fresh.series.domains.filter((d) => d.values.some((v) => v > 0)));
        drawSeries();
        ctx.setFaultBadge(fresh.alarms.active);
      }
    } catch { /* mantem a ultima leitura valida */ }
  }

  return () => { clearInterval(timer); unsubscribe(); offResize(); };
}

function componentBadge(row) {
  if (!row.present) return badge('ausente', 'neutral');
  if (row.health === 'healthy') return badge('saudável', 'good', 'good');
  if (row.health === 'unhealthy') return badge('não saudável', 'critical', 'critical');
  if (row.health === 'starting' || row.health === 'health: starting') return badge('iniciando', 'warning', 'warning');
  if (row.state === 'running') return badge('em execução', 'good', 'good');
  if (row.state === 'exited') return badge('parado', 'critical', 'critical');
  return badge(row.state || 'desconhecido', 'neutral');
}

function netconfBadge(nodes, name) {
  const node = nodes.find((n) => n.id === name);
  if (!node) return badge('não montado', 'neutral');
  const status = String(node.status).toLowerCase();
  if (status === 'connected') return badge('conectado', 'good', 'good');
  if (status === 'connecting') return badge('conectando', 'warning', 'warning');
  return badge(node.status || 'desconectado', 'critical', 'critical');
}
