// Inventario: funcoes de rede montadas no SDN-R e as capacidades YANG que cada
// uma anuncia. E a evidencia direta do mecanismo de descoberta de capacidade
// descrito na especificacao da interface O1.

import { el, api, card, table, badge, emptyState, clear, toast, fmtInt } from '../ui.js';
import { topologyDiagram } from './topology.js';

export async function render(root, ctx) {
  const [nodesRes, a1] = await Promise.all([
    api('/nodes'),
    api('/a1/overview').catch(() => ({ available: false })),
  ]);
  clear(root);

  const nodes = nodesRes.nodes || [];

  if (!nodesRes.ok) {
    root.append(card({
      title: 'Controlador indisponível',
      body: emptyState('Não foi possível consultar o SDN-R', 'Verifique se o contêiner "controller" está saudável.'),
    }));
    return () => {};
  }

  root.append(card({
    title: 'Topologia NETCONF',
    subtitle: 'Cada aresta O1 corresponde a um mountpoint mantido pelo SDN-R',
    body: topologyDiagram(nodes, { a1Available: a1.available }),
  }));

  root.append(el('div', { style: 'height:16px' }));

  if (!nodes.length) {
    root.append(card({
      title: 'Inventário',
      body: emptyState(
        'Nenhum elemento montado',
        'As funções de rede se registram via VES (PNF registration) e fazem NETCONF Call Home para o controlador. Isso leva de um a dois minutos após a subida.',
      ),
    }));
    return () => {};
  }

  root.append(el('div', { class: 'grid grid-cards' }, nodes.map((node) => nodeCard(node))));

  return () => {};
}

function nodeCard(node) {
  const connected = String(node.status).toLowerCase() === 'connected';
  const modules = node.modules || [];

  const search = el('input', {
    type: 'text',
    placeholder: 'filtrar módulos YANG…',
    'aria-label': `Filtrar módulos de ${node.id}`,
    style: 'margin-bottom:8px',
  });

  const chips = el('div', { class: 'chip-list' });
  const renderChips = (term = '') => {
    const filtered = modules.filter((m) => m.name.toLowerCase().includes(term.toLowerCase()));
    clear(chips);
    if (!filtered.length) {
      chips.append(el('span', { style: 'font-size:12px;color:var(--text-muted)', text: 'nenhum módulo corresponde ao filtro' }));
      return;
    }
    for (const m of filtered.slice(0, 400)) {
      chips.append(el('span', { class: 'chip', title: m.revision ? `revisão ${m.revision}` : m.raw, text: m.name }));
    }
  };
  renderChips();
  search.addEventListener('input', (e) => renderChips(e.target.value));

  const details = el('dl', { class: 'kv' }, [
    el('dt', { text: 'Estado' }), el('dd', {}, [
      connected ? badge('conectado', 'good', 'good') : badge(node.status || 'desconectado', 'critical', 'critical'),
    ]),
    el('dt', { text: 'Endereço' }), el('dd', { class: 'mono', text: node.host ? `${node.host}:${node.port || 830}` : '—' }),
    el('dt', { text: 'Módulos YANG' }), el('dd', { text: fmtInt(modules.length) }),
  ]);

  const unmountBtn = el('button', { class: 'btn btn-sm btn-danger', text: 'Desmontar' });
  unmountBtn.addEventListener('click', async () => {
    unmountBtn.disabled = true;
    try {
      await api(`/nodes/${encodeURIComponent(node.id)}/mount`, { method: 'DELETE' });
      toast('Mountpoint removido', `${node.id} foi desmontado do controlador.`, 'ok');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      toast('Falha ao desmontar', err.message, 'err');
      unmountBtn.disabled = false;
    }
  });

  return card({
    title: node.id,
    subtitle: connected ? 'Mountpoint NETCONF ativo' : 'Mountpoint inativo',
    actions: [unmountBtn],
    body: el('div', {}, [
      details,
      el('div', { class: 'section-title', style: 'margin-top:16px', text: 'Capacidades anunciadas' }),
      search,
      chips,
    ]),
  });
}
