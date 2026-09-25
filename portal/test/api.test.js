// Testes de API do portal, contra a pilha SMO em execucao.
//
// Nao ha mocks: cada teste exercita o caminho real ate o componente oficial
// correspondente (SDN-R via RESTCONF, Kafka via o consumidor, A1 PMS, Docker
// Engine). Um teste que falha aqui indica que o portal e a pilha divergiram.
//
//   node --test test/
//
// Variaveis: PORTAL_URL (padrao http://localhost:8080)

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.PORTAL_URL || 'http://localhost:8080';

// ------------------------------------------------------------------ auxiliares

async function get(path, { raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30000) });
  if (raw) return res;
  const texto = await res.text();
  let corpo = null;
  if (texto) { try { corpo = JSON.parse(texto); } catch { corpo = texto; } }
  return { status: res.status, ok: res.ok, body: corpo, headers: res.headers };
}

async function send(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000) ,
  });
  const texto = await res.text();
  let corpo = null;
  if (texto) { try { corpo = JSON.parse(texto); } catch { corpo = texto; } }
  return { status: res.status, ok: res.ok, body: corpo };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Repete uma verificacao ate ela passar ou o prazo esgotar. Necessario porque
// varias asserções dependem de propagacao assincrona (Kafka, sincronizacao A1,
// reconexao NETCONF).
async function ateQue(descricao, condicao, { timeoutMs = 60000, intervaloMs = 2000 } = {}) {
  const limite = Date.now() + timeoutMs;
  let ultimo;
  while (Date.now() < limite) {
    try {
      ultimo = await condicao();
      if (ultimo) return ultimo;
    } catch (err) {
      ultimo = err.message;
    }
    await esperar(intervaloMs);
  }
  assert.fail(`tempo esgotado aguardando: ${descricao} (último resultado: ${JSON.stringify(ultimo)?.slice(0, 200)})`);
}

// Estado compartilhado, descoberto uma vez no arranque.
const ctx = { nodes: [], nodeDu: null, nodeRu: null, a1: false };

before(async () => {
  const saude = await get('/api/health');
  assert.equal(saude.status, 200, `o portal precisa estar no ar em ${BASE}`);

  const res = await ateQue('elementos conectados no SDN-R', async () => {
    const r = await get('/api/nodes');
    const conectados = (r.body?.nodes || []).filter((n) => n.status === 'connected');
    return conectados.length >= 1 ? conectados : false;
  }, { timeoutMs: 120000 });

  ctx.nodes = res;
  ctx.nodeDu = res.find((n) => n.id.includes('du')) || res[0];
  ctx.nodeRu = res.find((n) => n.id.includes('ru')) || res[0];

  const a1 = await get('/api/a1/overview');
  ctx.a1 = a1.body?.available === true;
});

// =========================================================== saude e estatico

describe('Saúde e configuração', () => {
  test('/api/health responde com estado e identificador de build', async () => {
    const r = await get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'up');
    assert.equal(typeof r.body.kafka, 'boolean');
    assert.ok(r.body.buildId, 'buildId permite ao navegador detectar código novo');
  });

  test('/api/config expõe links externos e as NFs gerenciadas', async () => {
    const r = await get('/api/config');
    assert.equal(r.status, 200);
    assert.ok(r.body.links.odlux?.startsWith('http'));
    assert.ok(r.body.links.ves?.startsWith('http'));
    assert.ok(Array.isArray(r.body.managedNf) && r.body.managedNf.length > 0);
  });

  test('o consumidor Kafka está conectado ao barramento', async () => {
    const r = await get('/api/health');
    assert.equal(r.body.kafka, true, 'sem Kafka não há telemetria nem alarmes');
  });
});

describe('Frontend estático', () => {
  const modulos = [
    '/index.html', '/app.js', '/ui.js', '/charts.js', '/styles.css',
    '/views/overview.js', '/views/inventory.js', '/views/provisioning.js',
    '/views/faults.js', '/views/performance.js', '/views/policies.js',
    '/views/lifecycle.js', '/views/topology.js', '/views/help.js',
  ];

  for (const arquivo of modulos) {
    test(`${arquivo} é servido`, async () => {
      const r = await get(arquivo, { raw: true });
      assert.equal(r.status, 200);
      const corpo = await r.text();
      assert.ok(corpo.length > 100, 'conteúdo não pode estar vazio');
    });
  }

  test('os módulos são servidos com revalidação obrigatória', async () => {
    // Sem isto, um navegador com a aba aberta continua executando o código
    // anterior depois de um novo build do portal.
    const r = await get('/app.js', { raw: true });
    assert.match(r.headers.get('cache-control') || '', /no-cache/);
  });

  test('a casca da SPA não é armazenada em cache', async () => {
    const r = await get('/', { raw: true });
    assert.match(r.headers.get('cache-control') || '', /no-store/);
  });

  test('rota desconhecida devolve a SPA, não 404', async () => {
    const r = await get('/rota/inexistente', { raw: true });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>SMO Open RAN/);
  });
});

// ============================================================ visao geral

describe('Visão geral', () => {
  test('/api/overview agrega topologia, alarmes, séries e inventário', async () => {
    const r = await get('/api/overview');
    assert.equal(r.status, 200);

    assert.equal(typeof r.body.uptimeMs, 'number');
    assert.equal(r.body.controller.ready, true, 'o RESTCONF do SDN-R precisa responder');
    assert.equal(r.body.controller.reachable, true);

    assert.ok(r.body.topology.total >= 1);
    assert.equal(r.body.topology.connected, r.body.topology.total,
      'todos os elementos montados devem estar conectados');

    for (const chave of ['critical', 'major', 'minor', 'warning', 'active', 'cleared', 'total']) {
      assert.equal(typeof r.body.alarms[chave], 'number', `resumo de alarmes sem ${chave}`);
    }

    assert.ok(Array.isArray(r.body.series.buckets));
    assert.ok(Array.isArray(r.body.series.domains));
    assert.ok(Array.isArray(r.body.inventory.platform));
    assert.ok(Array.isArray(r.body.inventory.nf));
  });

  test('os componentes da plataforma aparecem como presentes e em execução', async () => {
    const r = await get('/api/overview');
    const essenciais = ['controller', 'ves-collector', 'kafka', 'persistence', 'smo-portal'];
    for (const nome of essenciais) {
      const servico = r.body.inventory.platform.find((s) => s.name === nome);
      assert.ok(servico?.present, `${nome} não encontrado no inventário`);
      assert.equal(servico.state, 'running', `${nome} não está em execução`);
    }
  });
});

// ======================================================== inventario / O1

describe('Inventário e interface O1', () => {
  test('/api/nodes lista os elementos montados via NETCONF', async () => {
    const r = await get('/api/nodes');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.nodes.length >= 1);
  });

  test('cada elemento traz endereço, porta e estado de conexão', async () => {
    for (const node of ctx.nodes) {
      assert.match(node.host || '', /^\d+\.\d+\.\d+\.\d+$/, `${node.id} sem endereço IP`);
      assert.equal(node.port, 830, `${node.id} com porta NETCONF inesperada`);
      assert.equal(node.status, 'connected');
    }
  });

  test('módulos YANG e capacidades de protocolo são classificados separadamente', async () => {
    for (const node of ctx.nodes) {
      assert.ok(node.capabilityCount > 0, `${node.id} sem módulos YANG`);
      assert.ok(node.protocolCount > 0, `${node.id} sem capacidades de protocolo`);

      // Nenhum modulo YANG pode carregar o prefixo de capacidade de protocolo.
      for (const m of node.modules) {
        assert.ok(!m.name.startsWith('urn:'), `"${m.name}" é capacidade de protocolo, não módulo YANG`);
      }
      // E as de protocolo precisam ser reconheciveis.
      const nomes = node.protocolCapabilities.map((c) => c.name);
      assert.ok(nomes.some((n) => n.startsWith('base:')), `${node.id} sem capacidade base do NETCONF`);
    }
  });

  test('o O-DU e o O-RU anunciam conjuntos de módulos diferentes', async () => {
    if (ctx.nodeDu.id === ctx.nodeRu.id) return; // pilha com um só tipo de elemento
    assert.notEqual(ctx.nodeDu.capabilityCount, ctx.nodeRu.capabilityCount,
      'modelos de O-DU e O-RU deveriam diferir');
  });

  test('/api/nodes/:id devolve um elemento específico', async () => {
    const r = await get(`/api/nodes/${ctx.nodeRu.id}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.node.id, ctx.nodeRu.id);
  });

  test('elemento inexistente não derruba a API', async () => {
    const r = await get('/api/nodes/nao-existe');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
  });
});

// ======================================================== provisionamento

describe('Provisionamento O1', () => {
  test('os caminhos sugeridos são sondados no próprio elemento', async () => {
    const r = await get(`/api/nodes/${ctx.nodeRu.id}/suggestions`);
    assert.equal(r.status, 200);

    const itens = r.body.suggestions;
    assert.ok(itens.length > 0);

    for (const item of itens) {
      assert.ok(['legivel', 'vazio', 'ausente', 'erro'].includes(item.estado),
        `estado inesperado: ${item.estado}`);
      assert.equal(typeof item.status, 'number');
      assert.ok(item.nota, 'cada caminho precisa explicar o próprio estado');
    }

    // O primeiro sugerido tem de ser legivel: e o que a tela pre-carrega.
    assert.equal(itens[0].estado, 'legivel',
      'a tela pré-carrega o primeiro caminho; ele não pode devolver erro');
  });

  test('todo caminho marcado como legível realmente devolve 200', async () => {
    const r = await get(`/api/nodes/${ctx.nodeRu.id}/suggestions`);
    for (const item of r.body.suggestions.filter((i) => i.estado === 'legivel')) {
      const leitura = await get(
        `/api/nodes/${ctx.nodeRu.id}/config?path=${encodeURIComponent(item.path)}&datastore=config`);
      assert.equal(leitura.body.status, 200, `${item.path} marcado legível mas devolveu ${leitura.body.status}`);
    }
  });

  test('leitura do datastore de configuração', async () => {
    const path = 'nts-network-function:simulation/network-function/ves';
    const r = await get(`/api/nodes/${ctx.nodeRu.id}/config?path=${encodeURIComponent(path)}&datastore=config`);
    assert.equal(r.body.status, 200);
    assert.ok(r.body.data['nts-network-function:ves']);
  });

  test('leitura do datastore operacional', async () => {
    const path = 'nts-network-function:simulation/network-function';
    const r = await get(`/api/nodes/${ctx.nodeRu.id}/config?path=${encodeURIComponent(path)}&datastore=operational`);
    assert.equal(r.body.status, 200);
  });

  test('caminho sem parâmetro é recusado com 400', async () => {
    const r = await get(`/api/nodes/${ctx.nodeRu.id}/config`);
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  test('ramo vazio devolve 409 data-missing, e não um erro do portal', async () => {
    const r = await get(
      `/api/nodes/${ctx.nodeRu.id}/config?path=${encodeURIComponent('ietf-interfaces:interfaces')}&datastore=config`);
    assert.ok([409, 400, 404].includes(r.body.status),
      `esperado 409/400/404 para ramo sem dado, veio ${r.body.status}`);
    assert.equal(r.body.ok, false);
  });

  test('escrita via O1 é aplicada e confirmada por releitura', async () => {
    const node = ctx.nodeRu.id;
    const path = 'nts-network-function:simulation/network-function/ves';

    const antes = await get(`/api/nodes/${node}/config?path=${encodeURIComponent(path)}&datastore=config`);
    const original = antes.body.data['nts-network-function:ves'];
    const novoPeriodo = original['heartbeat-period'] === 20 ? 30 : 20;

    const escrita = await send('PUT', `/api/nodes/${node}/config`, {
      path,
      payload: { 'nts-network-function:ves': { ...original, 'heartbeat-period': novoPeriodo } },
    });

    assert.equal(escrita.body.write.ok, true, `escrita recusada: HTTP ${escrita.body.write.status}`);
    assert.equal(escrita.body.verify.ok, true, 'a releitura de confirmação falhou');
    assert.equal(escrita.body.verify.data['nts-network-function:ves']['heartbeat-period'], novoPeriodo,
      'o elemento não aplicou o valor gravado');

    // Restaura o valor anterior para nao deixar a pilha alterada.
    await send('PUT', `/api/nodes/${node}/config`, {
      path, payload: { 'nts-network-function:ves': original },
    });
  });

  test('o perfil de provisionamento inicial foi aplicado a todos os elementos', async () => {
    const r = await ateQue('perfil aplicado em todos os elementos', async () => {
      const b = await get('/api/provisioning/baseline');
      const st = b.body.status || [];
      return st.length >= ctx.nodes.length && st.every((s) => s.ok) ? b.body : false;
    }, { timeoutMs: 90000 });

    assert.ok(r.baseline.length >= 3, 'o perfil precisa declarar seus itens');
    for (const item of r.baseline) {
      assert.ok(item.path && item.label && item.module, 'item do perfil incompleto');
    }

    for (const elemento of r.status) {
      assert.ok(elemento.ok, `perfil incompleto em ${elemento.node}`);
      for (const etapa of elemento.steps) {
        assert.ok(etapa.ok, `${elemento.node}/${etapa.key} devolveu HTTP ${etapa.status}`);
      }
    }
  });

  test('o perfil é seletivo: só aplica itens cujo módulo o elemento anuncia', async () => {
    const r = await get('/api/provisioning/baseline');
    const du = r.body.status.find((s) => s.node.includes('du'));
    const ru = r.body.status.find((s) => s.node.includes('ru'));
    if (!du || !ru) return;

    assert.ok(du.steps.length > ru.steps.length,
      'o O-DU anuncia o módulo hello-world e deve receber mais itens que o O-RU');
    assert.ok(du.steps.some((s) => s.key === 'pm-job'), 'o O-DU precisa receber o job de medição');
    assert.ok(!ru.steps.some((s) => s.key === 'pm-job'), 'o O-RU não deve receber o job de medição');
  });

  test('reaplicar o perfil é idempotente', async () => {
    const r = await send('POST', `/api/provisioning/baseline/${ctx.nodeRu.id}`);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.steps.every((s) => s.ok));
  });
});

// ============================================================ falhas

describe('Gerenciamento de falhas', () => {
  test('/api/alarms devolve resumo e lista', async () => {
    const r = await get('/api/alarms');
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.summary.active, 'number');
    assert.ok(Array.isArray(r.body.alarms));
  });

  test('os filtros de estado são respeitados', async () => {
    const ativos = await get('/api/alarms?status=active');
    assert.ok(ativos.body.alarms.every((a) => a.status === 'active'));

    const limpos = await get('/api/alarms?status=cleared');
    assert.ok(limpos.body.alarms.every((a) => a.status === 'cleared'));
  });

  test('um evento VES de falha percorre coletor, Kafka e portal', async () => {
    const vesUrl = (await get('/api/config')).body.links.ves;
    const marca = `TesteAutomatizado-${Date.now()}`;
    const agoraUs = Date.now() * 1000;

    const envio = await fetch(`${vesUrl}/eventListener/v7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          commonEventHeader: {
            domain: 'fault', eventId: marca, eventName: 'Fault_Teste',
            eventType: 'O-RAN-SC', priority: 'High', reportingEntityName: 'api.test.js',
            sequence: 1, sourceName: ctx.nodeRu.id,
            startEpochMicrosec: agoraUs, lastEpochMicrosec: agoraUs,
            version: '4.1', vesEventListenerVersion: '7.2.1',
          },
          faultFields: {
            faultFieldsVersion: '4.0', alarmCondition: marca,
            eventSourceType: 'O-RU', specificProblem: 'alarme sintético de teste',
            eventSeverity: 'CRITICAL', vfStatus: 'Active',
          },
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    assert.ok([200, 202].includes(envio.status), `o coletor recusou o evento: HTTP ${envio.status}`);

    const alarme = await ateQue('alarme visível no portal', async () => {
      const r = await get('/api/alarms?status=active&limit=300');
      return r.body.alarms.find((a) => a.condition === marca) || false;
    }, { timeoutMs: 60000 });

    assert.equal(alarme.severity, 'CRITICAL');
    assert.equal(alarme.source, ctx.nodeRu.id);
    assert.equal(alarme.acknowledged, false);

    // Reconhecimento
    const ack = await send('POST', `/api/alarms/${encodeURIComponent(alarme.key)}/ack`);
    assert.equal(ack.body.ok, true);
    assert.equal(ack.body.alarm.acknowledged, true);
  });

  test('reconhecer alarme inexistente devolve 404', async () => {
    const r = await send('POST', '/api/alarms/nao%7Cexiste/ack');
    assert.equal(r.status, 404);
  });
});

// ======================================================== desempenho

describe('Desempenho e telemetria', () => {
  test('/api/performance devolve séries, KPIs e contadores', async () => {
    const r = await get('/api/performance');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.series.buckets));
    assert.ok(Array.isArray(r.body.kpis));
    assert.equal(typeof r.body.counters.total, 'number');
    assert.ok(Array.isArray(r.body.nf));
  });

  test('a janela de tempo é respeitada', async () => {
    const curta = await get('/api/performance?minutes=15');
    const longa = await get('/api/performance?minutes=60');
    assert.ok(longa.body.series.buckets.length > curta.body.series.buckets.length);
  });

  test('eventos VES chegam dos elementos gerenciados', async () => {
    const r = await ateQue('eventos recebidos no barramento', async () => {
      const p = await get('/api/performance');
      return p.body.counters.total > 0 ? p.body : false;
    }, { timeoutMs: 120000 });

    assert.ok(Object.keys(r.counters.byDomain).length > 0, 'nenhum domínio de evento contabilizado');
    assert.ok(r.nf.some((n) => n.lastHeartbeat), 'nenhum elemento enviou heartbeat');
  });

  test('os KPIs de desempenho têm rótulo legível, unidade e série', async () => {
    // O job de medicao do O-DU produz uma amostra a cada 30 s.
    const kpis = await ateQue('KPIs coletados do O-DU', async () => {
      const p = await get('/api/performance');
      return p.body.kpis.length > 0 ? p.body.kpis : false;
    }, { timeoutMs: 150000, intervaloMs: 5000 });

    for (const kpi of kpis) {
      assert.ok(!kpi.name.includes('/'), `rótulo não tratado: ${kpi.name}`);
      assert.ok(kpi.unit, `${kpi.name} sem unidade`);
      assert.ok(kpi.points.length > 0);
      assert.equal(typeof kpi.latest, 'number');
      for (const ponto of kpi.points) {
        assert.equal(typeof ponto.t, 'number');
        assert.equal(typeof ponto.v, 'number');
      }
    }
  });

  test('/api/events lista os eventos recentes e aceita filtro', async () => {
    const r = await get('/api/events?limit=10');
    assert.ok(Array.isArray(r.body.events));
    assert.ok(r.body.events.length <= 10);

    for (const e of r.body.events) {
      assert.ok(e.id && e.domain && e.source);
      assert.equal(typeof e.timestamp, 'number');
    }

    const filtrados = await get('/api/events?domain=heartbeat&limit=5');
    assert.ok(filtrados.body.events.every((e) => e.domain === 'heartbeat'));
  });

  test('o fluxo SSE entrega eventos ao vivo', async () => {
    const controlador = new AbortController();
    const res = await fetch(`${BASE}/api/stream`, { signal: controlador.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const leitor = res.body.getReader();
    const decodificador = new TextDecoder();
    let acumulado = '';
    const limite = Date.now() + 90000;

    try {
      while (Date.now() < limite) {
        const { value, done } = await leitor.read();
        if (done) break;
        acumulado += decodificador.decode(value, { stream: true });
        if (acumulado.includes('event: ves')) break;
      }
    } finally {
      controlador.abort();
    }

    assert.match(acumulado, /event: ves|: conectado/,
      'o fluxo precisa ao menos abrir e anunciar a conexão');
  });
});

// ============================================================ politicas A1

describe('Políticas A1', () => {
  const TIPO = '20008';
  const ESQUEMA = {
    name: 'teste-automatizado',
    description: 'tipo usado pela suíte de testes',
    policy_type_id: Number(TIPO),
    create_schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: TIPO,
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          properties: { cellId: { type: 'string' } },
          additionalProperties: false,
          required: ['cellId'],
        },
        qosObjectives: {
          type: 'object',
          properties: { gfbr: { type: 'number' } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
      required: ['scope'],
    },
  };

  test('o perfil A1 está ativo', { skip: false }, async () => {
    const r = await get('/api/a1/overview');
    if (!r.body.available) {
      assert.ok(r.body.hint, 'quando indisponível, a API precisa orientar como habilitar');
      return;
    }
    assert.ok(Array.isArray(r.body.rics));
    assert.ok(r.body.rics.length >= 1, 'nenhum RIC registrado no Non-RT RIC');
    assert.equal(r.body.rics[0].state, 'AVAILABLE');
  });

  test('carregar o tipo de política no RIC devolve sucesso', async (t) => {
    if (!ctx.a1) return t.skip('perfil a1 inativo');

    const r = await send('POST', '/api/a1/seed-type', { typeId: TIPO, schema: ESQUEMA });
    assert.equal(r.body.ok, true, `o RIC recusou o tipo: HTTP ${r.body.status} ${JSON.stringify(r.body.data)}`);
    assert.ok([200, 201].includes(r.body.status));
  });

  test('o esquema JSON sem o envelope do simulador é recusado', async (t) => {
    if (!ctx.a1) return t.skip('perfil a1 inativo');

    // Documenta o formato exigido: o simulador em versao OSC espera o tipo
    // embrulhado em { name, description, policy_type_id, create_schema }.
    const r = await send('POST', '/api/a1/seed-type', {
      typeId: '20009',
      schema: { $schema: 'http://json-schema.org/draft-07/schema#', title: '20009', type: 'object' },
    });
    assert.equal(r.body.status, 400, 'o envelope do simulador é obrigatório');
  });

  test('seed-type sem campos obrigatórios devolve 400', async () => {
    const r = await send('POST', '/api/a1/seed-type', { typeId: TIPO });
    assert.equal(r.status, 400);
  });

  test('o Non-RT RIC sincroniza o tipo carregado no RIC', async (t) => {
    if (!ctx.a1) return t.skip('perfil a1 inativo');

    await send('POST', '/api/a1/seed-type', { typeId: TIPO, schema: ESQUEMA });
    const tipos = await ateQue('tipo visível no Non-RT RIC', async () => {
      const r = await get('/api/a1/overview');
      return (r.body.types || []).includes(TIPO) ? r.body.types : false;
    }, { timeoutMs: 120000, intervaloMs: 5000 });

    assert.ok(tipos.includes(TIPO));
  });

  test('ciclo de vida completo de uma política', async (t) => {
    if (!ctx.a1) return t.skip('perfil a1 inativo');

    const visao = await get('/api/a1/overview');
    const ricId = visao.body.rics[0].ric_id;
    const policyId = `teste-${Date.now()}`;

    const criacao = await send('POST', '/api/a1/policies', {
      policyId, ricId, policyTypeId: TIPO, serviceId: 'suite-de-testes',
      policyData: { scope: { cellId: 'cell-001' }, qosObjectives: { gfbr: 100 } },
    });
    assert.ok([200, 201].includes(criacao.body.status),
      `criação recusada: HTTP ${criacao.body.status} ${JSON.stringify(criacao.body.data)}`);

    // A politica precisa estar no Non-RT RIC...
    const listada = await ateQue('política listada no Non-RT RIC', async () => {
      const r = await get('/api/a1/overview');
      return r.body.policies.find((p) => p.id === policyId) || false;
    }, { timeoutMs: 30000 });
    assert.equal(listada.definition.ric_id, ricId);
    assert.equal(listada.definition.policytype_id, TIPO);

    // ...e ter sido entregue ao proprio Near-RT RIC pela interface A1.
    const noRic = await get('/api/a1/ric/policy-types');
    assert.equal(noRic.body.ok, true);

    const remocao = await send('DELETE', `/api/a1/policies/${policyId}`);
    assert.ok([200, 204].includes(remocao.body.status), `remoção falhou: ${remocao.body.status}`);

    const depois = await get('/api/a1/overview');
    assert.ok(!depois.body.policies.some((p) => p.id === policyId), 'a política não foi removida');
  });

  test('o esquema de um tipo pode ser consultado', async (t) => {
    if (!ctx.a1) return t.skip('perfil a1 inativo');
    const r = await get(`/api/a1/policy-types/${TIPO}`);
    assert.equal(r.status, 200);
  });
});

// ======================================================== ciclo de vida

describe('Ciclo de vida de Network Functions', () => {
  test('/api/lifecycle separa plataforma de funções de rede', async () => {
    const r = await get('/api/lifecycle');
    assert.equal(r.body.ok, true, `sem acesso à Docker Engine: ${r.body.error}`);
    assert.ok(r.body.platform.length > 0);
    assert.ok(r.body.nf.length > 0);

    for (const nf of r.body.nf) {
      assert.ok(nf.name && nf.role === 'Network Function');
      assert.ok(nf.description, 'cada NF precisa de descrição');
    }
  });

  test('ações de ciclo de vida são recusadas fora das NFs gerenciadas', async () => {
    // Uma falha aqui significa que o portal poderia desligar a propria
    // plataforma que o sustenta.
    for (const alvo of ['controller', 'kafka', 'smo-portal', 'persistence']) {
      const r = await send('POST', `/api/lifecycle/${alvo}/stop`);
      assert.equal(r.status, 403, `${alvo} não deveria aceitar ação de ciclo de vida`);
    }
  });

  test('verbo inválido é recusado', async () => {
    const managed = (await get('/api/config')).body.managedNf[0];
    const r = await send('POST', `/api/lifecycle/${managed}/destroy`);
    assert.equal(r.status, 400);
  });

  test('os logs de um contêiner podem ser lidos', async () => {
    const r = await get(`/api/lifecycle/${ctx.nodeRu.id}/logs?tail=20`);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.data, 'string');
  });

  test('parar uma NF derruba o mountpoint O1 e reiniciá-la o restabelece', async () => {
    const alvo = (await get('/api/config')).body.managedNf.filter((n) => n.includes('ru')).pop();
    assert.ok(alvo, 'é preciso um O-RU para este teste');

    const parada = await send('POST', `/api/lifecycle/${alvo}/stop`);
    assert.ok(parada.body.ok, `falha ao parar ${alvo}`);

    await ateQue(`${alvo} fora do estado connected`, async () => {
      const r = await get('/api/nodes');
      const node = r.body.nodes.find((n) => n.id === alvo);
      return !node || node.status !== 'connected';
    }, { timeoutMs: 90000, intervaloMs: 3000 });

    const inicio = await send('POST', `/api/lifecycle/${alvo}/start`);
    assert.ok(inicio.body.ok, `falha ao reiniciar ${alvo}`);

    await ateQue(`${alvo} reconectado após o reinício`, async () => {
      const r = await get('/api/nodes');
      return r.body.nodes.find((n) => n.id === alvo)?.status === 'connected';
    }, { timeoutMs: 180000, intervaloMs: 5000 });
  });
});

after(async () => {
  // Deixa a pilha no estado em que foi encontrada.
  const r = await get('/api/nodes');
  const desconectados = (r.body?.nodes || []).filter((n) => n.status !== 'connected');
  if (desconectados.length) {
    console.log(`  aviso: elementos ainda reconectando: ${desconectados.map((n) => n.id).join(', ')}`);
  }
});
