// Caminhos de configuracao sugeridos por elemento.
//
// A lista de modulos YANG que um elemento anuncia diz o que ele *suporta*, nao
// o que ele tem *gravado*. Ler um ramo suportado mas vazio devolve HTTP 409
// (data-missing), e ler um modulo que o elemento nao anuncia devolve 400.
// Por isso a tela nao pode oferecer uma lista fixa: o portal sonda os
// candidatos no proprio elemento e informa o resultado de cada um.

import { sdnr } from './sdnr.js';

const NTS = 'nts-network-function:simulation/network-function';
const DU = 'o-ran-sc-du-hello-world:network-function';

// Candidatos avaliados em todo elemento. A sondagem descarta os que nao servem.
const CANDIDATOS = [
  { path: `${NTS}/ves`, label: 'Telemetria VES (cadência de heartbeat)' },
  { path: `${NTS}/fault-generation`, label: 'Padrão de geração de falhas' },
  { path: `${NTS}/netconf`, label: 'Notificações NETCONF' },
  { path: DU, label: 'Função de rede O-DU (células, RRM, PM)' },
  { path: `${DU}/subscription-streams=stream-smo`, label: 'Assinatura de streaming de PM' },
  { path: 'ietf-interfaces:interfaces', label: 'Interfaces (ietf-interfaces)' },
  { path: 'ietf-hardware:hardware', label: 'Inventário de hardware' },
  { path: 'o-ran-uplane-conf:user-plane-configuration', label: 'Configuração do plano de usuário' },
  { path: 'o-ran-sync:sync', label: 'Sincronismo' },
  { path: 'o-ran-usermgmt:users', label: 'Gerência de usuários' },
];

// Resultado da sondagem por elemento, com validade curta: o conteudo do
// datastore muda com o provisionamento, e uma tela recarregada deve refletir
// isso sem reiniciar o portal.
const cache = new Map();
const VALIDADE_MS = 60_000;

function classificar(status) {
  if (status === 200) return { estado: 'legivel', nota: 'há configuração gravada neste ramo' };
  if (status === 409) return { estado: 'vazio', nota: 'o elemento anuncia o módulo, mas não há dado gravado neste ramo' };
  if (status === 400 || status === 404) return { estado: 'ausente', nota: 'este elemento não anuncia o módulo YANG' };
  return { estado: 'erro', nota: `o controlador respondeu HTTP ${status}` };
}

export async function suggestionsFor(nodeId) {
  const agora = Date.now();
  const anterior = cache.get(nodeId);
  if (anterior && agora - anterior.at < VALIDADE_MS) return anterior.items;

  const items = [];
  for (const candidato of CANDIDATOS) {
    const res = await sdnr.readMount(nodeId, candidato.path, 'config');
    items.push({ ...candidato, status: res.status, ...classificar(res.status) });
  }

  // Os caminhos com conteúdo vêm primeiro; os ausentes, por último.
  const ordem = { legivel: 0, vazio: 1, erro: 2, ausente: 3 };
  items.sort((a, b) => ordem[a.estado] - ordem[b.estado]);

  cache.set(nodeId, { at: agora, items });
  return items;
}

export function invalidateSuggestions(nodeId) {
  if (nodeId) cache.delete(nodeId);
  else cache.clear();
}
