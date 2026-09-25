// Ciclo de vida das funcoes de rede.
//
// Nesta implantacao as NFs da pilha Open RAN sao conteineres, e o ciclo de vida
// (instanciar, parar, reiniciar) e exercido pela Docker Engine API. E o mesmo
// papel que o NFO desempenha no modelo de referencia de SMO: no perfil leve o
// ciclo de vida se resume a iniciar, monitorar e encerrar os conteineres; no
// perfil completo seria Helm sobre Kubernetes, e sobre O-Cloud seria a O2dms.

import http from 'node:http';
import { config } from './config.js';

function dockerRequest(path, method = 'GET') {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: config.docker.socket, path, method, timeout: 20000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let data = null;
          if (body) { try { data = JSON.parse(body); } catch { data = body; } }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, data: null, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.end();
  });
}

const ALL_SERVICES = [
  { name: 'controller', role: 'SMO / OAM', description: 'SDN-R (OpenDaylight) - cliente NETCONF da interface O1' },
  { name: 'ves-collector', role: 'SMO / OAM', description: 'Coletor de eventos VES da interface O1' },
  { name: 'kafka', role: 'Mensageria', description: 'Barramento de eventos do SMO' },
  { name: 'zookeeper', role: 'Mensageria', description: 'Coordenacao do Kafka' },
  { name: 'persistence', role: 'Persistencia', description: 'MariaDB - base de dados do SDN-R' },
  { name: 'odlux', role: 'SMO / OAM', description: 'Interface web oficial do controlador' },
  { name: 'a1-pms', role: 'Non-RT RIC', description: 'A1 Policy Management Service' },
  { name: 'near-rt-ric', role: 'Near-RT RIC', description: 'Simulador da interface A1' },
  { name: 'smo-portal', role: 'Operacao', description: 'Este portal' },
];

export const lcm = {
  // Estado de todos os conteineres da solucao, separando plataforma de NFs.
  async inventory() {
    const res = await dockerRequest('/containers/json?all=true');
    if (!res.ok) return { ok: false, error: res.error || `docker status ${res.status}`, platform: [], nf: [] };

    const byName = new Map();
    for (const c of res.data || []) {
      for (const n of c.Names || []) byName.set(n.replace(/^\//, ''), c);
    }

    const describe = (name, meta = {}) => {
      const c = byName.get(name);
      if (!c) return { name, present: false, state: 'absent', ...meta };
      return {
        name,
        present: true,
        state: c.State,
        status: c.Status,
        image: c.Image,
        createdAt: c.Created * 1000,
        health: /\((healthy|unhealthy|starting|health: starting)\)/.exec(c.Status || '')?.[1] || null,
        ...meta,
      };
    };

    return {
      ok: true,
      platform: ALL_SERVICES.map((s) => describe(s.name, { role: s.role, description: s.description })),
      nf: config.managedNf.map((n) => describe(n, { role: 'Network Function', description: nfDescription(n) })),
    };
  },

  // Acoes de ciclo de vida, restritas as NFs gerenciadas para evitar que o portal
  // desligue a propria plataforma que o sustenta.
  async action(name, verb) {
    if (!config.managedNf.includes(name)) {
      return { ok: false, status: 403, error: `'${name}' nao e uma Network Function gerenciada` };
    }
    const allowed = { start: 'start', stop: 'stop', restart: 'restart' };
    if (!allowed[verb]) return { ok: false, status: 400, error: `acao invalida: ${verb}` };

    const res = await dockerRequest(`/containers/${encodeURIComponent(name)}/${allowed[verb]}`, 'POST');
    // 304 = ja estava no estado desejado.
    if (res.status === 304) return { ok: true, status: 304, message: 'ja estava nesse estado' };
    return res;
  },

  async logs(name, tail = 200) {
    if (!config.managedNf.includes(name) && !ALL_SERVICES.some((s) => s.name === name)) {
      return { ok: false, status: 403, error: 'container nao gerenciado' };
    }
    const res = await dockerRequest(`/containers/${encodeURIComponent(name)}/logs?stdout=true&stderr=true&tail=${tail}`);
    if (!res.ok) return res;
    // O stream multiplexado do Docker prefixa cada quadro com 8 bytes de cabecalho.
    const text = typeof res.data === 'string' ? res.data.replace(/[\u0000-\u0008\u000b-\u001f]/g, '') : '';
    return { ok: true, status: 200, data: text };
  },
};

function nfDescription(name) {
  if (name.startsWith('o-du')) return 'O-DU simulada (NTS-NG) - NETCONF O1 + eventos VES';
  if (name.startsWith('o-ru')) return 'O-RU simulada (NTS-NG, fronthaul) - NETCONF O1 + eventos VES';
  return 'Funcao de rede gerenciada pelo SMO';
}
