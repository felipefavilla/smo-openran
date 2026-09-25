// Ciclo de vida de Network Functions.
//
// No perfil leve o ciclo de vida se resume a iniciar, monitorar e encerrar os
// conteineres que implementam as funcoes de rede. Parar uma NF derruba o
// mountpoint NETCONF correspondente no SDN-R — o efeito e visivel na tela de
// Inventario e no diagrama de topologia, o que evidencia o acoplamento entre o
// ciclo de vida e a interface O1.

import { el, api, card, table, badge, emptyState, clear, toast, fmtDateTime } from '../ui.js';

export async function render(root, ctx) {
  let data = await api('/lifecycle');
  let nodes = (await api('/nodes').catch(() => ({ nodes: [] }))).nodes || [];
  clear(root);

  const nfBox = el('div');
  const platformBox = el('div');
  const logBox = el('div');

  if (!data.ok) {
    root.append(card({
      title: 'Ciclo de vida indisponível',
      body: emptyState('Sem acesso à Docker Engine API', data.error || 'Verifique a montagem do socket do Docker no contêiner do portal.'),
    }));
    return () => {};
  }

  function drawNf() {
    clear(nfBox);
    if (!data.nf.length) {
      nfBox.append(emptyState('Nenhuma função de rede declarada'));
      return;
    }
    nfBox.append(table([
      {
        label: 'Função de rede',
        render: (r) => el('span', {}, [
          el('div', { style: 'font-weight:600', text: r.name }),
          el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: r.description || '' }),
        ]),
      },
      { label: 'Contêiner', render: stateBadge },
      { label: 'NETCONF (O1)', render: (r) => netconfBadge(r.name) },
      { label: 'Criado em', render: (r) => el('span', { style: 'font-size:12.5px;white-space:nowrap', text: r.createdAt ? fmtDateTime(r.createdAt) : '—' }) },
      {
        label: 'Ações',
        render: (r) => el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          actionBtn(r, 'start', 'Iniciar', r.state === 'running'),
          actionBtn(r, 'restart', 'Reiniciar', r.state !== 'running'),
          actionBtn(r, 'stop', 'Parar', r.state !== 'running', 'btn-danger'),
          logBtn(r),
        ]),
      },
    ], data.nf));
  }

  function drawPlatform() {
    clear(platformBox);
    platformBox.append(table([
      {
        label: 'Componente',
        render: (r) => el('span', {}, [
          el('div', { style: 'font-weight:600', text: r.name }),
          el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: r.description || '' }),
        ]),
      },
      { label: 'Camada', render: (r) => badge(r.role || '—', 'neutral') },
      { label: 'Imagem', mono: true, render: (r) => r.present ? shortImage(r.image) : '—' },
      { label: 'Estado', render: stateBadge },
    ], data.platform));
  }

  function actionBtn(row, verb, label, disabled, extraClass = '') {
    const b = el('button', { class: `btn btn-sm ${extraClass}`.trim(), type: 'button', text: label, disabled: disabled || !row.present });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const res = await api(`/lifecycle/${encodeURIComponent(row.name)}/${verb}`, { method: 'POST' });
        if (res.ok) {
          toast(`${label} solicitado`, `${row.name}: operação aceita pela Docker Engine.`, 'ok');
          setTimeout(reload, 2500);
        } else {
          toast('Operação recusada', res.error || `HTTP ${res.status}`, 'err');
          b.disabled = false;
        }
      } catch (err) {
        toast('Falha na operação', err.message, 'err');
        b.disabled = false;
      }
    });
    return b;
  }

  function logBtn(row) {
    const b = el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Logs', disabled: !row.present });
    b.addEventListener('click', async () => {
      b.disabled = true;
      clear(logBox).append(el('div', { class: 'loading' }, [el('div', { class: 'spinner' })]));
      try {
        const res = await api(`/lifecycle/${encodeURIComponent(row.name)}/logs?tail=120`);
        clear(logBox).append(
          el('div', { class: 'section-title', text: `Últimas linhas de ${row.name}` }),
          el('pre', { class: 'code', text: res.data || '(sem saída)' }),
        );
        logBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        clear(logBox).append(emptyState('Não foi possível ler os logs', err.message));
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  function netconfBadge(name) {
    const node = nodes.find((n) => n.id === name);
    if (!node) return badge('não montado', 'neutral');
    const status = String(node.status).toLowerCase();
    if (status === 'connected') return badge('conectado', 'good', 'good');
    if (status === 'connecting') return badge('conectando', 'warning', 'warning');
    return badge(node.status || 'desconectado', 'critical', 'critical');
  }

  async function reload() {
    try {
      [data, nodes] = await Promise.all([
        api('/lifecycle'),
        api('/nodes').then((r) => r.nodes || []).catch(() => []),
      ]);
      drawNf(); drawPlatform();
    } catch { /* mantem a ultima leitura valida */ }
  }

  root.append(card({
    title: 'Funções de rede gerenciadas',
    subtitle: 'Parar uma NF derruba o mountpoint NETCONF correspondente no controlador',
    body: nfBox,
  }));
  drawNf();

  root.append(el('div', { style: 'height:16px' }));
  root.append(el('div', { id: 'log-slot' }, [logBox]));

  root.append(card({
    title: 'Componentes da plataforma',
    subtitle: 'Serviços do SMO — exibidos para diagnóstico, sem ações de ciclo de vida',
    body: platformBox,
  }));
  drawPlatform();

  const timer = setInterval(reload, 15000);
  return () => clearInterval(timer);
}

function stateBadge(row) {
  if (!row.present) return badge('ausente', 'neutral');
  if (row.health === 'healthy') return badge('saudável', 'good', 'good');
  if (row.health === 'unhealthy') return badge('não saudável', 'critical', 'critical');
  if (row.health === 'starting') return badge('iniciando', 'warning', 'warning');
  if (row.state === 'running') return badge('em execução', 'good', 'good');
  if (row.state === 'exited') return badge('parado', 'critical', 'critical');
  return badge(row.state || 'desconhecido', 'neutral');
}

function shortImage(image) {
  if (!image) return '—';
  const parts = String(image).split('/');
  return parts[parts.length - 1];
}
