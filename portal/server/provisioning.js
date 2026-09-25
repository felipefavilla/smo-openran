// Provisionamento inicial (dia 1) das funcoes de rede, executado pelo SMO.
//
// Os simuladores NTS-NG sobem com o container "ves" do modulo
// nts-network-function vazio: sem periodo de heartbeat, sem registro de PNF e
// sem geracao de falhas. E o O-DU nao produz nenhuma medicao de desempenho ate
// que exista um job de medicao — o proprio modelo YANG o diz: "to activate the
// production of the specified performance measurement, the SMO needs to create
// a performance-measurement-job instance".
//
// Sem esses parametros o elemento fica conectado mas nao reporta nada: a
// interface O1 existe e nao transporta dados. Defini-los e, por natureza,
// trabalho de gerenciamento de configuracao do SMO, e este modulo o faz pelo
// caminho normal da O1 — um PUT RESTCONF no SDN-R, que o traduz num
// <edit-config> NETCONF para o elemento, seguido de releitura de confirmacao.

import { sdnr } from './sdnr.js';

const NTS = 'nts-network-function:simulation/network-function';
const DU = 'o-ran-sc-du-hello-world:network-function';

// Perfil comum a qualquer funcao de rede NTS-NG.
const COMUM = [
  {
    key: 'ves',
    module: 'nts-network-function',
    path: `${NTS}/ves`,
    label: 'Telemetria VES',
    description: 'Registro de PNF, heartbeat periódico e reporte de falhas pela interface O1',
    payload: {
      'nts-network-function:ves': {
        'faults-enabled': true,
        'pnf-registration': true,
        'heartbeat-period': 30,
      },
    },
  },
  {
    key: 'netconf',
    module: 'nts-network-function',
    path: `${NTS}/netconf`,
    label: 'Notificações NETCONF',
    description: 'Notificações de falha pelo próprio canal NETCONF; Call Home desativado',
    payload: {
      'nts-network-function:netconf': {
        'faults-enabled': true,
        'call-home': false,
      },
    },
  },
  {
    key: 'fault-generation',
    module: 'nts-network-function',
    path: `${NTS}/fault-generation`,
    label: 'Padrão de geração de falhas',
    description: 'Cadência com que o elemento emite eventos de falha, para exercitar o FM',
    payload: {
      'nts-network-function:fault-generation': {
        'fault-delay-list': [
          { index: 0, 'delay-period': 30 },
          { index: 1, 'delay-period': 45 },
          { index: 2, 'delay-period': 60 },
        ],
      },
    },
  },
];

// Itens aplicaveis apenas a elementos que anunciam o modulo do O-DU.
const DU_ITENS = [
  {
    key: 'subscription-stream',
    module: 'o-ran-sc-du-hello-world',
    path: `${DU}/subscription-streams=stream-smo`,
    label: 'Assinatura de streaming',
    description: 'Destino VES para onde o elemento envia as medições de desempenho',
    payload: {
      'o-ran-sc-du-hello-world:subscription-streams': [
        {
          id: 'stream-smo',
          'user-label': 'stream para o SMO',
          'administrative-state': 'unlocked',
          'ves-endpoint-protocol': 'http',
          'ves-endpoint-ip': 'ves-collector',
          'ves-endpoint-port': 8080,
          'ves-endpoint-auth-method': 'basic-auth',
          'ves-endpoint-username': 'sample1',
          'ves-endpoint-password': 'sample1',
        },
      ],
    },
  },
  {
    key: 'pm-job',
    module: 'o-ran-sc-du-hello-world',
    path: `${DU}/performance-measurement-jobs=pm-job-smo`,
    label: 'Job de medição de desempenho',
    description: 'Ativa a produção de KPIs de vazão por célula, com granularidade de 30 s',
    // Construido em tempo de execucao: as metricas dependem de quais celulas o
    // elemento expoe e de quais medicoes cada uma declara suportar.
    build: buildPmJob,
  },
];

export const BASELINE = [...COMUM, ...DU_ITENS];

// Descobre no proprio elemento as celulas e as medicoes suportadas, e monta o
// job de medicao correspondente. E o passo de descoberta que antecede o
// provisionamento.
// Tipos de medicao definidos como identidades no modelo o-ran-sc-du-hello-world.
// Servem de recuo quando a lista supported-measurements nao esta presente no
// datastore operacional do elemento — no simulador NTS-NG ela e populada no
// arranque e nem sempre persiste.
const TIPOS_PADRAO = [
  'o-ran-sc-du-hello-world:user-equipment-average-throughput-downlink',
  'o-ran-sc-du-hello-world:user-equipment-average-throughput-uplink',
];

async function buildPmJob(nodeId) {
  const res = await sdnr.readMount(nodeId, DU, 'config');
  if (!res.ok) return null;

  const nf = res.data?.['o-ran-sc-du-hello-world:network-function'] || {};
  const metrics = [];

  const referencia = (dufId, cellId, tipo) =>
    `/o-ran-sc-du-hello-world:network-function` +
    `/distributed-unit-functions[id='${dufId}']` +
    `/cell[id='${cellId}']` +
    `/supported-measurements[performance-measurement-type='${tipo}']`;

  for (const duf of nf['distributed-unit-functions'] || []) {
    for (const cell of duf.cell || []) {
      // A leitura no topo da funcao de rede poda as listas de estado; as
      // medicoes suportadas, quando presentes, aparecem lendo a celula.
      const det = await sdnr.readMount(
        nodeId,
        `${DU}/distributed-unit-functions=${encodeURIComponent(duf.id)}/cell=${encodeURIComponent(cell.id)}`,
        'operational',
      );

      const detalhe = det.ok ? det.data?.['o-ran-sc-du-hello-world:cell']?.[0] || {} : {};
      const anunciados = (detalhe['supported-measurements'] || [])
        .map((sm) => sm['performance-measurement-type'])
        .filter(Boolean);

      for (const tipo of anunciados.length ? anunciados : TIPOS_PADRAO) {
        metrics.push(referencia(duf.id, cell.id, tipo));
      }
    }
  }

  if (!metrics.length) return null;

  return {
    'o-ran-sc-du-hello-world:performance-measurement-jobs': [
      {
        id: 'pm-job-smo',
        'user-label': 'Vazão média por célula',
        'administrative-state': 'unlocked',
        'job-tag': 'smo-throughput',
        'granularity-period': 30,
        'stream-target': 'stream-smo',
        'performance-metrics': metrics,
      },
    ],
  };
}

// Estado por elemento: quando foi provisionado e o resultado de cada etapa.
const state = new Map();

export const provisioning = {
  baseline: BASELINE.map(({ key, path, label, description, module }) => ({ key, path, label, description, module })),

  status() {
    return [...state.values()].sort((a, b) => a.node.localeCompare(b.node));
  },

  // Aplica o perfil a um elemento, pulando os itens cujo modulo YANG ele nao
  // anuncia. `force` reaplica mesmo se ja provisionado.
  async apply(nodeId, { force = false, modules = null } = {}) {
    const current = state.get(nodeId);
    if (current?.ok && !force) return current;

    let anunciados = modules;
    if (!anunciados) {
      const info = await sdnr.node(nodeId);
      anunciados = (info.node?.modules || []).map((m) => m.name);
    }
    const suporta = (nome) => !anunciados.length || anunciados.includes(nome);

    const steps = [];
    for (const item of BASELINE) {
      if (!suporta(item.module)) continue;

      const payload = item.build ? await item.build(nodeId) : item.payload;
      if (!payload) {
        steps.push({ key: item.key, label: item.label, path: item.path, ok: false, status: 0,
          error: 'não foi possível montar o conteúdo a partir do datastore do elemento' });
        continue;
      }

      const write = await sdnr.writeMount(nodeId, item.path, payload);
      const verify = write.ok ? await sdnr.readMount(nodeId, item.path, 'config') : null;
      steps.push({
        key: item.key,
        label: item.label,
        path: item.path,
        status: write.status,
        ok: write.ok,
        applied: verify?.ok ? verify.data : null,
        error: write.ok ? null : write.data,
      });
    }

    const result = {
      node: nodeId,
      ok: steps.length > 0 && steps.every((s) => s.ok),
      appliedAt: Date.now(),
      steps,
    };
    state.set(nodeId, result);
    console.log(`[provisioning] ${nodeId}: ${result.ok ? 'perfil aplicado' : 'falha ao aplicar perfil'} (${steps.length} etapas)`);
    return result;
  },

  // Reconciliador: percorre os elementos conectados e provisiona os que ainda
  // nao foram. Roda no arranque e periodicamente, cobrindo tambem os elementos
  // que conectam depois de o portal ja estar no ar.
  async reconcile() {
    const res = await sdnr.nodes();
    if (!res.ok) return;

    for (const node of res.nodes) {
      if (String(node.status).toLowerCase() !== 'connected') continue;
      if (state.get(node.id)?.ok) continue;
      try {
        await this.apply(node.id, { modules: (node.modules || []).map((m) => m.name) });
      } catch (err) {
        console.warn(`[provisioning] ${node.id}: ${err.message}`);
      }
    }
  },

  start(intervalMs = 30000) {
    const tick = () => this.reconcile().catch(() => {});
    setTimeout(tick, 5000);
    return setInterval(tick, intervalMs);
  },
};
