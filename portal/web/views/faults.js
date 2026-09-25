// Gerenciamento de falhas: alarmes correntes derivados dos eventos VES de
// dominio "fault" publicados pelo VES Collector no barramento do SMO.

import {
  el, api, card, tile, table, badge, emptyState, clear, toast,
  fmtInt, fmtDateTime, fmtAgo, severityKind, severityLabel, statusIcon,
} from '../ui.js';
import { horizontalBars, onResize } from '../charts.js';

const SEVERITY_ORDER = ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING'];
const SEVERITY_COLOR = {
  CRITICAL: 'var(--critical)',
  MAJOR: 'var(--serious)',
  MINOR: 'var(--warning)',
  WARNING: 'var(--warning)',
};

export async function render(root, ctx) {
  let filter = 'active';
  let data = await api(`/alarms?status=${filter}&limit=300`);
  clear(root);

  ctx.setFaultBadge(data.summary.active);

  // --------------------------------------------------------------- resumo
  const tiles = el('div', { class: 'grid grid-tiles', style: 'margin-bottom:16px' });
  const chartBox = el('div');
  const tableBox = el('div');

  const filterButtons = el('div', { class: 'card-head-actions' }, [
    filterBtn('Ativos', 'active'),
    filterBtn('Limpos', 'cleared'),
    filterBtn('Todos', 'all'),
  ]);

  function filterBtn(label, value) {
    const b = el('button', { class: `btn btn-sm${filter === value ? ' btn-primary' : ''}`, type: 'button', text: label });
    b.addEventListener('click', async () => {
      filter = value;
      for (const child of filterButtons.children) child.className = 'btn btn-sm';
      b.className = 'btn btn-sm btn-primary';
      await reload();
    });
    return b;
  }

  function drawSummary() {
    const s = data.summary;
    clear(tiles).append(
      tile({
        label: 'Alarmes ativos',
        value: fmtInt(s.active),
        tone: s.active === 0 ? 'good' : s.critical > 0 ? 'critical' : null,
        meta: [statusIcon(s.active === 0 ? 'good' : s.critical > 0 ? 'critical' : 'warning'),
          s.active === 0 ? 'rede sem alarme pendente' : 'aguardando tratamento'],
      }),
      tile({ label: 'Críticos', value: fmtInt(s.critical), tone: s.critical ? 'critical' : null,
        meta: [statusIcon(s.critical ? 'critical' : 'good'), 'severidade CRITICAL'] }),
      tile({ label: 'Maiores', value: fmtInt(s.major),
        meta: [statusIcon(s.major ? 'serious' : 'good'), 'severidade MAJOR'] }),
      tile({ label: 'Alarmes limpos', value: fmtInt(s.cleared),
        meta: [statusIcon('good'), 'encerrados por evento NORMAL'] }),
    );
  }

  function drawChart() {
    const counts = {};
    for (const a of data.alarms) {
      if (a.status !== 'active') continue;
      const sev = String(a.severity).toUpperCase();
      counts[sev] = (counts[sev] || 0) + 1;
    }
    const items = SEVERITY_ORDER
      .filter((s) => counts[s])
      .map((s) => ({ label: severityLabel(s), value: counts[s], color: SEVERITY_COLOR[s], tooltipLabel: 'Alarmes ativos' }));

    if (!items.length) {
      clear(chartBox).append(emptyState('Nenhum alarme ativo', 'A distribuição por severidade aparece quando houver alarmes pendentes.'));
      return;
    }
    horizontalBars(chartBox, { items });
  }

  function drawTable() {
    clear(tableBox);
    if (!data.alarms.length) {
      tableBox.append(emptyState(
        filter === 'active' ? 'Nenhum alarme ativo' : 'Nenhum alarme neste filtro',
        'Os alarmes chegam pelo tópico VES de falhas assim que um elemento os reporta.',
      ));
      return;
    }

    tableBox.append(table([
      {
        label: 'Severidade',
        render: (a) => badge(severityLabel(a.severity), severityKind(a.severity), severityKind(a.severity)),
      },
      { label: 'Elemento', render: (a) => el('span', { style: 'font-weight:600', text: a.source }) },
      {
        label: 'Condição',
        render: (a) => el('span', {}, [
          el('div', { class: 'mono', text: a.condition }),
          a.specificProblem && a.specificProblem !== a.condition
            ? el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: a.specificProblem })
            : null,
        ]),
      },
      { label: 'Ocorrências', align: 'right', render: (a) => fmtInt(a.count) },
      { label: 'Levantado em', render: (a) => el('span', { style: 'white-space:nowrap' }, [
        el('div', { text: fmtDateTime(a.raisedAt) }),
        el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: fmtAgo(a.lastSeen) }),
      ]) },
      { label: 'Estado', render: (a) => a.status === 'cleared'
        ? badge('limpo', 'good', 'good')
        : a.acknowledged ? badge('reconhecido', 'neutral') : badge('ativo', 'critical', 'critical') },
      {
        label: '',
        render: (a) => {
          if (a.status === 'cleared' || a.acknowledged) return el('span', { text: '' });
          const b = el('button', { class: 'btn btn-sm', type: 'button', text: 'Reconhecer' });
          b.addEventListener('click', async () => {
            b.disabled = true;
            try {
              await api(`/alarms/${encodeURIComponent(a.key)}/ack`, { method: 'POST' });
              toast('Alarme reconhecido', `${a.condition} em ${a.source}.`, 'ok');
              await reload();
            } catch (err) {
              toast('Falha ao reconhecer', err.message, 'err');
              b.disabled = false;
            }
          });
          return b;
        },
      },
    ], data.alarms));
  }

  async function reload() {
    try {
      data = await api(`/alarms?status=${filter}&limit=300`);
      drawSummary(); drawChart(); drawTable();
      ctx.setFaultBadge(data.summary.active);
    } catch { /* mantem a ultima leitura valida */ }
  }

  drawSummary();
  root.append(tiles);

  root.append(card({
    title: 'Distribuição por severidade',
    subtitle: 'Alarmes ativos agrupados pela severidade reportada no evento VES',
    body: chartBox,
  }));
  drawChart();

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Alarmes',
    subtitle: 'Um alarme é encerrado quando o elemento envia a mesma condição com severidade NORMAL',
    actions: [filterButtons],
    body: tableBox,
  }));
  drawTable();

  // Atualizacao ao vivo: um alarme novo redesenha a tela imediatamente.
  const unsubscribe = ctx.subscribe((type, payload) => {
    if (type === 'alarm' || (type === 'ves' && (payload.domain === 'fault' || payload.domain === 'fault3gpp'))) reload();
  });
  const timer = setInterval(reload, 20000);
  const offResize = onResize(drawChart);

  return () => { clearInterval(timer); unsubscribe(); offResize(); };
}
