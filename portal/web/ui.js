// Utilitarios compartilhados pelas telas: criacao de elementos, formatacao,
// chamadas a API e notificacoes.

export const SERIES_SLOTS = 8;

// Cor de serie por indice. A atribuicao segue a ordem fixa da paleta e nunca
// e ciclada: alem do oitavo slot, a serie e agrupada em "outros" pela tela.
export function seriesColor(index) {
  return `var(--series-${Math.min(index + 1, SERIES_SLOTS)})`;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ------------------------------------------------------------------- API ----

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, data });
  return data;
}

// ------------------------------------------------------------ formatacao ----

const nfInt = new Intl.NumberFormat('pt-BR');
const nfDec = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const fmtInt = (n) => (Number.isFinite(n) ? nfInt.format(n) : '—');
export const fmtNum = (n) => (Number.isFinite(n) ? nfDec.format(n) : '—');

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function fmtAgo(ts) {
  if (!ts) return '—';
  return fmtDuration(Date.now() - ts) + ' atrás';
}

// Nomes legiveis para os dominios de evento VES.
const DOMAIN_LABELS = {
  fault: 'Falha',
  fault3gpp: 'Falha 3GPP',
  heartbeat: 'Heartbeat',
  measurement: 'Medição',
  pnfRegistration: 'Registro de PNF',
  notification: 'Notificação',
  fileReady: 'Arquivo pronto',
  pmStreaming: 'PM streaming',
  stndDefined: 'Padrão definido',
  other: 'Outros',
};
export const domainLabel = (d) => DOMAIN_LABELS[d] || d;

// ------------------------------------------------------------- componentes --

export function badge(text, kind = 'neutral', icon = null) {
  const children = [];
  if (icon) children.push(statusIcon(icon));
  else children.push(el('span', { class: 'badge-dot' }));
  children.push(text);
  return el('span', { class: `badge badge-${kind}` }, children);
}

// Icone que acompanha cada cor de status — a cor nunca carrega o significado
// sozinha.
export function statusIcon(kind) {
  const paths = {
    good: 'M20 6L9 17l-5-5',
    warning: 'M12 8v5M12 16.5v.5M10.3 3.9L2.5 17.4a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    serious: 'M12 8v5M12 16.5v.5M10.3 3.9L2.5 17.4a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    critical: 'M12 7v6M12 16.5v.5M12 2a10 10 0 100 20 10 10 0 000-20z',
    neutral: 'M12 2a10 10 0 100 20 10 10 0 000-20z',
  };
  const svg = svgEl('svg', { class: 'badge-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d: paths[kind] || paths.neutral }));
  return svg;
}

// Mapeia a severidade VES para um papel de status.
export function severityKind(severity) {
  const s = String(severity || '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'MAJOR') return 'serious';
  if (s === 'MINOR' || s === 'WARNING') return 'warning';
  if (s === 'NORMAL') return 'good';
  return 'neutral';
}

export function severityLabel(severity) {
  const map = { CRITICAL: 'Crítico', MAJOR: 'Maior', MINOR: 'Menor', WARNING: 'Aviso', NORMAL: 'Normal' };
  return map[String(severity || '').toUpperCase()] || severity || '—';
}

export function card({ title, subtitle, actions, body, id }) {
  const head = el('div', { class: 'card-head' }, [
    el('div', { class: 'card-head-text' }, [
      el('h2', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null,
    ]),
    actions ? el('div', { class: 'card-head-actions' }, actions) : null,
  ]);
  return el('div', { class: 'card', id }, [head, el('div', { class: 'card-body' }, [body])]);
}

export function tile({ label, value, meta, tone }) {
  return el('div', { class: 'card tile' }, [
    el('div', { class: 'tile-label', text: label }),
    el('div', { class: `tile-value${tone ? ` is-${tone}` : ''}`, text: value }),
    meta ? el('div', { class: 'tile-meta' }, [].concat(meta)) : null,
  ]);
}

export function emptyState(title, hint) {
  return el('div', { class: 'empty' }, [el('strong', { text: title }), hint ? el('span', { text: hint }) : null]);
}

export function table(columns, rows) {
  const thead = el('thead', {}, [el('tr', {}, columns.map((c) => el('th', { text: c.label, style: c.width ? `width:${c.width}` : null })))]);
  const tbody = el('tbody', {}, rows.map((row) =>
    el('tr', {}, columns.map((c) => {
      const value = c.render ? c.render(row) : row[c.key];
      return el('td', { class: c.align === 'right' ? 'num' : c.mono ? 'mono' : null },
        value && value.nodeType ? [value] : [value === undefined || value === null ? '—' : String(value)]);
    })),
  ));
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [thead, tbody])]);
}

// ------------------------------------------------------------------ toast ---

export function toast(title, message, kind = '') {
  const node = el('div', { class: `toast ${kind}` }, [
    el('strong', { text: title }),
    message ? el('span', { text: message }) : null,
  ]);
  document.getElementById('toasts').append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s ease';
    setTimeout(() => node.remove(), 220);
  }, 4200);
}
