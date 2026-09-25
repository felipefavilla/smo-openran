// Graficos em SVG, sem biblioteca externa.
//
// Especificacao das marcas: linhas de 2px, marcadores de 8px, topo arredondado
// de 4px ancorado na linha de base, vao de 2px na cor da superficie entre
// segmentos empilhados e entre barras vizinhas, grade e eixos em fio recessivo.

import { el, svgEl, clear, fmtInt, fmtNum } from './ui.js';

const NS_PAD = { top: 12, right: 14, bottom: 26, left: 44 };
const SEG_GAP = 2;      // vao na cor da superficie entre segmentos
const CORNER = 4;       // raio da extremidade de dado
const MARKER = 8;       // diametro minimo de marcador

// ------------------------------------------------------------------ tooltip --

let tooltipNode = null;

function tooltip() {
  if (!tooltipNode) {
    tooltipNode = el('div', { class: 'chart-tooltip', role: 'presentation' });
    document.body.append(tooltipNode);
  }
  return tooltipNode;
}

function showTooltip(evt, title, rows) {
  const tt = tooltip();
  clear(tt);
  tt.append(el('div', { class: 'tt-title', text: title }));
  for (const r of rows) {
    tt.append(el('div', { class: 'tt-row' }, [
      r.color ? el('span', { class: 'tt-swatch', style: `background:${r.color}` }) : null,
      el('span', { text: r.label }),
      el('span', { class: 'tt-val', text: r.value }),
    ]));
  }
  tt.classList.add('show');
  positionTooltip(evt);
}

function positionTooltip(evt) {
  const tt = tooltip();
  const rect = tt.getBoundingClientRect();
  let x = evt.clientX + 14;
  let y = evt.clientY + 14;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - 14;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - 14;
  tt.style.left = `${Math.max(8, x)}px`;
  tt.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  if (tooltipNode) tooltipNode.classList.remove('show');
}

// ------------------------------------------------------------------ escalas --

function niceCeil(value) {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  const norm = value / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function yTicks(max, count = 4) {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

// ------------------------------------------------------- barras empilhadas --

// series: [{ name, color, values: number[] }] alinhadas a `labels`.
export function stackedBars(container, { labels, series, height = 200, valueFormat = fmtInt, tooltipTitle }) {
  clear(container);
  const w = Math.max(container.clientWidth || 640, 320);
  const h = height;
  const pad = NS_PAD;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
  const max = niceCeil(Math.max(1, ...totals));

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img' });
  const yToPx = (v) => pad.top + plotH - (v / max) * plotH;

  // grade recessiva e rotulos do eixo y
  for (const t of yTicks(max)) {
    const y = yToPx(t);
    svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: w - pad.right, y1: y, y2: y }));
    svg.append(svgEl('text', { class: 'tick-label', x: pad.left - 8, y: y + 3.5, 'text-anchor': 'end', text: fmtInt(t) }));
  }
  svg.append(svgEl('line', { class: 'axis-line', x1: pad.left, x2: w - pad.right, y1: yToPx(0), y2: yToPx(0) }));

  const slot = plotW / Math.max(labels.length, 1);
  const barW = Math.max(3, Math.min(slot - SEG_GAP, 26));

  labels.forEach((label, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const x = cx - barW / 2;
    let acc = 0;
    const stackTop = totals[i];

    series.forEach((s) => {
      const v = s.values[i] || 0;
      if (v <= 0) return;
      const yTop = yToPx(acc + v);
      const yBottom = yToPx(acc);
      const isTop = Math.abs(acc + v - stackTop) < 1e-9;
      let segH = yBottom - yTop - (isTop ? 0 : SEG_GAP);
      if (segH < 1) segH = 1;

      svg.append(svgEl('path', {
        d: roundedTopRect(x, yTop, barW, segH, isTop ? Math.min(CORNER, barW / 2, segH) : 0),
        fill: s.color,
      }));
      acc += v;
    });
  });

  // camada de interacao: uma faixa por intervalo, com fio de cruzamento
  const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH, opacity: 0 });
  svg.append(crosshair);

  labels.forEach((label, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const hit = svgEl('rect', { class: 'hit', x: pad.left + slot * i, y: pad.top, width: slot, height: plotH });
    hit.addEventListener('mouseenter', (evt) => {
      crosshair.setAttribute('x1', cx);
      crosshair.setAttribute('x2', cx);
      crosshair.setAttribute('opacity', 1);
      const rows = series
        .map((s) => ({ label: s.name, value: valueFormat(s.values[i] || 0), color: s.color, raw: s.values[i] || 0 }))
        .filter((r) => r.raw > 0)
        .sort((a, b) => b.raw - a.raw);
      rows.push({ label: 'Total', value: valueFormat(totals[i]), color: null });
      showTooltip(evt, tooltipTitle ? tooltipTitle(label, i) : label, rows);
    });
    hit.addEventListener('mousemove', positionTooltip);
    hit.addEventListener('mouseleave', () => { crosshair.setAttribute('opacity', 0); hideTooltip(); });
    svg.append(hit);
  });

  // rotulos do eixo x, desbastados para nunca colidirem
  const every = Math.max(1, Math.ceil(labels.length / Math.floor(plotW / 62)));
  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    const cx = pad.left + slot * i + slot / 2;
    svg.append(svgEl('text', { class: 'tick-label', x: cx, y: h - 8, 'text-anchor': 'middle', text: label }));
  });

  container.append(svg);
  return svg;
}

function roundedTopRect(x, y, w, h, r) {
  if (r <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${y + r} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} h${-w} Z`;
}

// ------------------------------------------------------------ serie temporal --

// points: [{ t, v }] — uma unica serie; o titulo do cartao a nomeia, por isso
// nao ha legenda.
export function timeSeries(container, { points, color = 'var(--series-1)', height = 170, unit = '', label = 'valor' }) {
  clear(container);
  if (!points.length) {
    container.append(el('div', { class: 'empty' }, [el('strong', { text: 'Sem amostras' })]));
    return null;
  }

  const w = Math.max(container.clientWidth || 640, 300);
  const h = height;
  const pad = { ...NS_PAD, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const values = points.map((p) => p.v);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values, 0);
  const max = niceCeil(rawMax === rawMin ? rawMax + 1 : rawMax);
  const min = rawMin < 0 ? -niceCeil(-rawMin) : 0;

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);

  const xToPx = (t) => pad.left + ((t - t0) / span) * plotW;
  const yToPx = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img' });

  for (const t of yTicks(max)) {
    const y = yToPx(t);
    svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: w - pad.right, y1: y, y2: y }));
    svg.append(svgEl('text', { class: 'tick-label', x: pad.left - 8, y: y + 3.5, 'text-anchor': 'end', text: fmtNum(t) }));
  }

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xToPx(p.t).toFixed(1)},${yToPx(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${xToPx(t1).toFixed(1)},${yToPx(min).toFixed(1)} L${xToPx(t0).toFixed(1)},${yToPx(min).toFixed(1)} Z`;

  svg.append(svgEl('path', { d: area, fill: color, opacity: 0.1 }));
  svg.append(svgEl('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // rotulo direto apenas no ponto final — nunca um numero em cada ponto
  const last = points[points.length - 1];
  svg.append(svgEl('circle', { cx: xToPx(last.t), cy: yToPx(last.v), r: MARKER / 2, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
  svg.append(svgEl('text', {
    class: 'value-label',
    x: Math.min(xToPx(last.t) + 9, w - pad.right),
    y: yToPx(last.v) - 9,
    'text-anchor': 'end',
    text: `${fmtNum(last.v)}${unit ? ` ${unit}` : ''}`,
  }));

  const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH, opacity: 0 });
  const focus = svgEl('circle', { r: MARKER / 2, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2, opacity: 0 });
  svg.append(crosshair, focus);

  const hit = svgEl('rect', { class: 'hit', x: pad.left, y: pad.top, width: plotW, height: plotH });
  hit.addEventListener('mousemove', (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * w;
    const t = t0 + ((px - pad.left) / plotW) * span;
    let nearest = points[0];
    for (const p of points) if (Math.abs(p.t - t) < Math.abs(nearest.t - t)) nearest = p;

    const cx = xToPx(nearest.t);
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx); crosshair.setAttribute('opacity', 1);
    focus.setAttribute('cx', cx); focus.setAttribute('cy', yToPx(nearest.v)); focus.setAttribute('opacity', 1);

    showTooltip(evt, new Date(nearest.t).toLocaleTimeString('pt-BR'), [
      { label, value: `${fmtNum(nearest.v)}${unit ? ` ${unit}` : ''}`, color },
    ]);
  });
  hit.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    focus.setAttribute('opacity', 0);
    hideTooltip();
  });
  svg.append(hit);

  const fmtX = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  svg.append(svgEl('text', { class: 'tick-label', x: pad.left, y: h - 8, 'text-anchor': 'start', text: fmtX(t0) }));
  svg.append(svgEl('text', { class: 'tick-label', x: w - pad.right, y: h - 8, 'text-anchor': 'end', text: fmtX(t1) }));

  container.append(svg);
  return svg;
}

// ------------------------------------------------------------ barras horizontais --

// items: [{ label, value, color, icon }] — uma categoria por barra.
export function horizontalBars(container, { items, valueFormat = fmtInt, barHeight = 26 }) {
  clear(container);
  if (!items.length) {
    container.append(el('div', { class: 'empty' }, [el('strong', { text: 'Sem dados' })]));
    return null;
  }

  const w = Math.max(container.clientWidth || 520, 280);
  const labelW = Math.min(150, Math.max(90, w * 0.3));
  const valueW = 56;
  const gap = 10;
  const h = items.length * (barHeight + SEG_GAP) + 6;
  const trackX = labelW + gap;
  const trackW = Math.max(40, w - trackX - valueW - gap);
  const max = niceCeil(Math.max(1, ...items.map((i) => i.value)));

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img' });

  items.forEach((item, i) => {
    const y = i * (barHeight + SEG_GAP) + 3;
    const barW = Math.max(item.value > 0 ? 3 : 0, (item.value / max) * trackW);

    svg.append(svgEl('text', {
      class: 'tick-label', x: labelW, y: y + barHeight / 2 + 4, 'text-anchor': 'end',
      text: item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label,
    }));

    svg.append(svgEl('rect', { x: trackX, y: y + 4, width: trackW, height: barHeight - 8, rx: 3, fill: 'var(--grid)', opacity: 0.55 }));

    if (barW > 0) {
      const r = Math.min(CORNER, barW);
      svg.append(svgEl('path', {
        d: `M${trackX},${y + 4} h${barW - r} a${r},${r} 0 0 1 ${r},${r} v${barHeight - 8 - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(barW - r)} Z`,
        fill: item.color || 'var(--series-1)',
      }));
    }

    svg.append(svgEl('text', {
      class: 'value-label', x: w, y: y + barHeight / 2 + 4, 'text-anchor': 'end', text: valueFormat(item.value),
    }));

    const hit = svgEl('rect', { class: 'hit', x: 0, y, width: w, height: barHeight });
    hit.addEventListener('mouseenter', (evt) => showTooltip(evt, item.label, [
      { label: item.tooltipLabel || 'Quantidade', value: valueFormat(item.value), color: item.color || 'var(--series-1)' },
    ]));
    hit.addEventListener('mousemove', positionTooltip);
    hit.addEventListener('mouseleave', hideTooltip);
    svg.append(hit);
  });

  container.append(svg);
  return svg;
}

// ------------------------------------------------------------------ legenda --

export function legend(items) {
  return el('div', { class: 'legend' }, items.map((i) =>
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-swatch', style: `background:${i.color}` }),
      i.label,
    ]),
  ));
}

// Redesenha os graficos quando a janela muda de largura.
export function onResize(fn) {
  let timer = null;
  const handler = () => { clearTimeout(timer); timer = setTimeout(fn, 160); };
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}
