// Cliente RESTCONF (RFC 8040) do SDN-R / OpenDaylight.
//
// O SDN-R e o cliente NETCONF da interface O1: mantem um mountpoint por funcao
// de rede, descobre as capacidades YANG anunciadas por cada uma e permite ler e
// escrever configuracao atraves de /yang-ext:mount.

import { config } from './config.js';

const TOPOLOGY = 'network-topology:network-topology/topology=topology-netconf';

function authHeader() {
  const token = Buffer.from(`${config.sdnc.username}:${config.sdnc.password}`).toString('base64');
  return `Basic ${token}`;
}

async function request(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const url = `${config.sdnc.baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: authHeader(),
        Accept: 'application/yang-data+json, application/json',
        ...(body ? { 'Content-Type': 'application/yang-data+json' } : {}),
      },
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export const sdnr = {
  // O endpoint /ready pertence a camada SDNC do ONAP e nao existe nesta imagem
  // em modo SDNRONLY. O sinal de prontidao e o proprio RESTCONF responder.
  async ready() {
    try {
      const res = await request('/rests/data/network-topology:network-topology?content=nonconfig', { timeoutMs: 6000 });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Inventario de funcoes de rede montadas via NETCONF.
  async nodes() {
    const res = await request(`/rests/data/${TOPOLOGY}?content=nonconfig`);
    if (!res.ok) return { ok: false, status: res.status, nodes: [], error: res.data };

    const topo = res.data?.['network-topology:topology']?.[0] || res.data?.topology?.[0] || {};
    const nodes = (topo.node || []).map(mapNode);
    return { ok: true, nodes };
  },

  async node(nodeId) {
    const res = await request(`/rests/data/${TOPOLOGY}/node=${encodeURIComponent(nodeId)}?content=nonconfig`);
    if (!res.ok) return { ok: false, status: res.status, error: res.data };
    const raw = res.data?.['network-topology:node']?.[0] || res.data?.node?.[0] || res.data;
    return { ok: true, node: mapNode(raw), raw };
  },

  // Leitura de um caminho arbitrario dentro do datastore da funcao de rede.
  async readMount(nodeId, path, datastore = 'config') {
    const clean = String(path).replace(/^\/+/, '');
    const q = datastore === 'operational' ? '?content=nonconfig' : '?content=config';
    return request(`/rests/data/${TOPOLOGY}/node=${encodeURIComponent(nodeId)}/yang-ext:mount/${clean}${q}`);
  },

  // Escrita de configuracao: equivale a um edit-config NETCONF no elemento.
  async writeMount(nodeId, path, payload) {
    const clean = String(path).replace(/^\/+/, '');
    return request(`/rests/data/${TOPOLOGY}/node=${encodeURIComponent(nodeId)}/yang-ext:mount/${clean}`, {
      method: 'PUT',
      body: payload,
    });
  },

  // Registro manual de um mountpoint (usado como alternativa ao NETCONF Call Home).
  async mountNode(nodeId, { host, port = 830, username, password }) {
    const body = {
      'network-topology:node': [
        {
          'node-id': nodeId,
          'netconf-node-topology:host': host,
          'netconf-node-topology:port': port,
          'netconf-node-topology:username': username,
          'netconf-node-topology:password': password,
          'netconf-node-topology:tcp-only': false,
          'netconf-node-topology:keepalive-delay': 120,
        },
      ],
    };
    return request(`/rests/data/${TOPOLOGY}/node=${encodeURIComponent(nodeId)}`, { method: 'PUT', body });
  },

  async unmountNode(nodeId) {
    return request(`/rests/data/${TOPOLOGY}/node=${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
  },
};

// Achata a representacao RESTCONF de um no NETCONF para o formato da UI.
//
// Ate o OpenDaylight Argon os atributos do conector ficavam no proprio no, com
// o prefixo "netconf-node-topology:". A partir do Calcium — versao usada pelo
// SDN-R 13 — eles ficam aninhados no container "netconf-node-topology:netconf-node".
// A busca abaixo cobre as duas formas.
function mapNode(raw = {}) {
  const nested = raw['netconf-node-topology:netconf-node'] || raw['netconf-node'] || {};

  const pick = (suffix) => {
    for (const source of [raw, nested]) {
      for (const [k, v] of Object.entries(source)) {
        if (k === suffix || k.endsWith(`:${suffix}`)) return v;
      }
    }
    return undefined;
  };

  const caps = pick('available-capabilities')?.['available-capability'] || [];
  const analisadas = caps.map((c) => parseCapability(c.capability || c)).filter(Boolean);

  // A lista anunciada mistura duas coisas: os modulos YANG que o elemento
  // suporta e as capacidades do proprio protocolo NETCONF (candidate, xpath,
  // validate...). Para o inventario, as interessantes sao as primeiras.
  const modules = analisadas.filter((c) => c.kind === 'yang');
  const protocolo = analisadas.filter((c) => c.kind === 'protocol');

  return {
    id: raw['node-id'],
    status: pick('connection-status') || 'unknown',
    host: pick('host'),
    port: pick('port'),
    clusteredConnectionStatus: pick('clustered-connection-status'),
    connectedMessage: pick('connected-message'),
    capabilityCount: modules.length,
    protocolCount: protocolo.length,
    modules,
    protocolCapabilities: protocolo,
  };
}

// Duas formas aparecem na lista de capacidades:
//   modulo YANG      "(urn:ietf:params:xml:ns:yang:ietf-interfaces?revision=2018-02-20)ietf-interfaces"
//   capac. protocolo "urn:ietf:params:netconf:capability:candidate:1.0"
function parseCapability(cap) {
  if (typeof cap !== 'string') return null;

  const yang = cap.match(/^\(([^)]*)\)(.+)$/);
  if (yang) {
    const rev = yang[1].match(/revision=([0-9-]+)/);
    return { kind: 'yang', name: yang[2], revision: rev ? rev[1] : null, raw: cap };
  }

  const protocolo = cap.match(/^urn:ietf:params:netconf:(?:capability:)?(.+)$/);
  return {
    kind: 'protocol',
    name: protocolo ? protocolo[1] : cap,
    revision: null,
    raw: cap,
  };
}
