// Diagrama de topologia: o SMO no topo, as interfaces O-RAN como arestas
// rotuladas e os elementos gerenciados na base. A cor da aresta reflete o
// estado real da conexao NETCONF lida do SDN-R.

import { svgEl, el } from '../ui.js';

export function topologyDiagram(nodes, { a1Available = false } = {}) {
  const managed = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const boxW = 148;
  const boxH = 54;
  const gap = 20;
  const cols = Math.max(managed.length, 1);
  const width = Math.max(560, cols * (boxW + gap) + gap + (a1Available ? boxW + gap : 0));
  const height = 260;

  const svg = svgEl('svg', {
    class: 'topology',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Diagrama de topologia entre o SMO e os elementos gerenciados',
  });

  // --------------------------------------------------------------- SMO (topo)
  const smoW = 300;
  const smoX = (width - smoW) / 2;
  svg.append(svgEl('rect', { class: 'node-box node-smo', x: smoX, y: 16, width: smoW, height: 56, rx: 10 }));
  svg.append(svgEl('text', { class: 'node-label', x: width / 2, y: 40, 'text-anchor': 'middle', text: 'SMO — O-RAN Software Community' }));
  svg.append(svgEl('text', { class: 'node-sub', x: width / 2, y: 57, 'text-anchor': 'middle', text: 'OAM (SDN-R, VES Collector) · Non-RT RIC' }));

  const smoBottom = 72;
  const rowY = 176;

  // --------------------------------------------------- elementos gerenciados
  if (!managed.length) {
    svg.append(svgEl('text', {
      class: 'node-sub', x: width / 2, y: rowY + 30, 'text-anchor': 'middle',
      text: 'Nenhum elemento montado no controlador ainda',
    }));
  }

  const totalW = managed.length * boxW + (managed.length - 1) * gap;
  let x = (width - totalW) / 2 - (a1Available ? (boxW + gap) / 2 : 0);

  for (const node of managed) {
    const connected = String(node.status).toLowerCase() === 'connected';
    const cx = x + boxW / 2;

    // aresta O1
    svg.append(svgEl('path', {
      class: `link${connected ? '' : ' link-down'}`,
      d: `M${width / 2},${smoBottom} C${width / 2},${smoBottom + 44} ${cx},${rowY - 44} ${cx},${rowY}`,
      fill: 'none',
      stroke: connected ? 'var(--series-1)' : 'var(--critical)',
    }));
    svg.append(svgEl('text', {
      class: 'edge-label', x: cx + 6, y: rowY - 14, 'text-anchor': 'start', text: 'O1',
    }));

    svg.append(svgEl('rect', { class: 'node-box', x, y: rowY, width: boxW, height: boxH, rx: 9 }));
    svg.append(svgEl('text', { class: 'node-label', x: cx, y: rowY + 22, 'text-anchor': 'middle', text: node.id }));
    svg.append(svgEl('text', {
      class: 'node-sub', x: cx, y: rowY + 39, 'text-anchor': 'middle',
      text: connected ? `${node.capabilityCount} módulos YANG` : String(node.status || 'desconectado'),
    }));

    // marcador de estado, sempre acompanhado do rotulo textual acima
    svg.append(svgEl('circle', {
      cx: x + boxW - 12, cy: rowY + 12, r: 4,
      fill: connected ? 'var(--good)' : 'var(--critical)',
      stroke: 'var(--surface-1)', 'stroke-width': 2,
    }));

    x += boxW + gap;
  }

  // ------------------------------------------------------------- Near-RT RIC
  if (a1Available) {
    const cx = x + boxW / 2;
    svg.append(svgEl('path', {
      class: 'link',
      d: `M${width / 2},${smoBottom} C${width / 2},${smoBottom + 44} ${cx},${rowY - 44} ${cx},${rowY}`,
      fill: 'none',
      stroke: 'var(--series-3)',
    }));
    svg.append(svgEl('text', { class: 'edge-label', x: cx + 6, y: rowY - 14, 'text-anchor': 'start', text: 'A1' }));
    svg.append(svgEl('rect', { class: 'node-box', x, y: rowY, width: boxW, height: boxH, rx: 9 }));
    svg.append(svgEl('text', { class: 'node-label', x: cx, y: rowY + 22, 'text-anchor': 'middle', text: 'Near-RT RIC' }));
    svg.append(svgEl('text', { class: 'node-sub', x: cx, y: rowY + 39, 'text-anchor': 'middle', text: 'políticas A1' }));
  }

  const caption = el('div', { class: 'legend' }, [
    el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:var(--series-1)' }), 'O1 — NETCONF + VES']),
    a1Available ? el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:var(--series-3)' }), 'A1 — políticas']) : null,
    el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:var(--critical)' }), 'conexão inativa']),
  ]);

  return el('div', {}, [svg, caption]);
}
