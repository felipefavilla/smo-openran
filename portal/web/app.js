// Casca da aplicacao: roteamento, tema, fluxo de eventos ao vivo (SSE) e
// ciclo de vida das telas.

import { api, toast } from './ui.js';

import * as overview from './views/overview.js';
import * as inventory from './views/inventory.js';
import * as provisioning from './views/provisioning.js';
import * as faults from './views/faults.js';
import * as performance from './views/performance.js';
import * as policies from './views/policies.js';
import * as lifecycle from './views/lifecycle.js';
import * as help from './views/help.js';

const VIEWS = {
  overview:     { mod: overview,     title: 'Visão geral',            subtitle: 'Estado consolidado da pilha SMO e da rede gerenciada' },
  inventory:    { mod: inventory,    title: 'Inventário e topologia', subtitle: 'Funções de rede montadas via NETCONF e suas capacidades YANG' },
  provisioning: { mod: provisioning, title: 'Provisionamento O1',     subtitle: 'Leitura e escrita de configuração nos elementos via RESTCONF/NETCONF' },
  faults:       { mod: faults,       title: 'Gerenciamento de falhas', subtitle: 'Alarmes correntes recebidos pela interface O1 (eventos VES)' },
  performance:  { mod: performance,  title: 'Desempenho e telemetria', subtitle: 'Fluxo de eventos e indicadores coletados da rede' },
  policies:     { mod: policies,     title: 'Políticas A1',           subtitle: 'Non-RT RIC: RICs gerenciados, tipos e instâncias de política' },
  lifecycle:    { mod: lifecycle,    title: 'Ciclo de vida de NF',    subtitle: 'Instanciar, parar e reiniciar as funções de rede gerenciadas' },
  help:         { mod: help,         title: 'Ajuda',                  subtitle: 'Guia de apoio ao uso da aplicação' },
};

const state = {
  current: null,
  cleanup: null,
  config: { links: {}, managedNf: [] },
  eventSource: null,
  listeners: new Set(),
};

// ------------------------------------------------------------------- tema ---

function initTheme() {
  const saved = (() => { try { return localStorage.getItem('smo-theme'); } catch { return null; } })();
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;

  document.getElementById('theme-btn').addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('smo-theme', next); } catch { /* armazenamento indisponivel */ }
    if (state.current) render(state.current);
  });
}

// ------------------------------------------------------- fluxo de eventos ---

function initStream() {
  const conn = document.getElementById('conn-state');
  const label = conn.querySelector('.conn-label');

  const connect = () => {
    const es = new EventSource('/api/stream');
    state.eventSource = es;

    es.onopen = () => {
      conn.dataset.state = 'live';
      label.textContent = 'fluxo ao vivo';
    };
    es.onerror = () => {
      conn.dataset.state = 'down';
      label.textContent = 'reconectando…';
    };
    es.addEventListener('ves', (e) => dispatch('ves', JSON.parse(e.data)));
    es.addEventListener('alarm', (e) => dispatch('alarm', JSON.parse(e.data)));
  };

  connect();
}

function dispatch(type, payload) {
  for (const fn of state.listeners) {
    try { fn(type, payload); } catch { /* uma tela com erro nao derruba as demais */ }
  }
}

// Permite a tela ativa assinar o fluxo; a assinatura e desfeita na troca de tela.
export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

// Contador de alarmes ativos no menu lateral.
export function setFaultBadge(count) {
  const badge = document.getElementById('nav-faults');
  badge.textContent = String(count);
  badge.hidden = !count;
}

// ---------------------------------------------------------------- roteador --

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '') || 'overview';
  return VIEWS[hash] ? hash : 'overview';
}

async function render(name) {
  const view = VIEWS[name];
  const content = document.getElementById('conteudo');

  if (state.cleanup) { try { state.cleanup(); } catch { /* ignora */ } state.cleanup = null; }
  state.listeners.clear();
  state.current = name;

  document.getElementById('view-title').textContent = view.title;
  document.getElementById('view-subtitle').textContent = view.subtitle;
  for (const item of document.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.view === name);
  }
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');

  content.replaceChildren(
    Object.assign(document.createElement('div'), {
      className: 'loading',
      innerHTML: '<div class="spinner" aria-hidden="true"></div><p>Carregando…</p>',
    }),
  );

  try {
    state.cleanup = await view.mod.render(content, { config: state.config, subscribe, setFaultBadge });
  } catch (err) {
    content.replaceChildren(
      Object.assign(document.createElement('div'), {
        className: 'empty',
        innerHTML: `<strong>Não foi possível carregar esta tela</strong><span>${escapeHtml(err.message || String(err))}</span>`,
      }),
    );
    toast('Erro ao carregar', err.message || String(err), 'err');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ boot ----

async function boot() {
  initTheme();

  document.getElementById('menu-btn').addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const open = sidebar.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  document.getElementById('refresh-btn').addEventListener('click', () => render(state.current || 'overview'));

  try {
    state.config = await api('/config');
    const links = state.config.links || {};
    if (links.odlux) document.getElementById('link-odlux').href = links.odlux;
    // O /eventListener/v7 so aceita POST; a raiz do coletor responde a GET.
    if (links.ves) document.getElementById('link-ves').href = links.ves;
  } catch {
    // O portal continua utilizavel mesmo sem a configuracao de links externos.
  }

  initStream();
  vigiarNovaVersao();
  window.addEventListener('hashchange', () => render(currentRoute()));
  await render(currentRoute());
}

// O frontend e servido sem nomes versionados, entao um navegador com a aba
// aberta continuaria executando os modulos antigos depois de um novo build do
// portal. O identificador de build muda a cada reinicio do processo; quando ele
// muda, a pagina avisa e recarrega.
function vigiarNovaVersao() {
  const inicial = state.config.buildId;
  if (!inicial) return;

  setInterval(async () => {
    try {
      const { buildId } = await api('/health');
      if (!buildId || buildId === inicial || state.recarregando) return;
      state.recarregando = true;
      toast('Nova versão do portal', 'Recarregando para carregar o código atualizado…', 'ok');
      setTimeout(() => location.reload(), 1500);
    } catch { /* portal reiniciando; a proxima verificacao resolve */ }
  }, 20000);
}

boot();
