// Politicas A1 do Non-RT RIC.
//
// O A1 Policy Management Service concentra a comunicacao com o Near-RT RIC: ele
// descobre os RICs gerenciados, publica os tipos de politica que cada um
// suporta e mantem o ciclo de vida das instancias. A tela permite carregar um
// tipo de politica no RIC, criar uma instancia e conferir no proprio RIC que a
// politica chegou pela interface A1.

import { el, api, card, table, badge, emptyState, clear, toast, fmtInt } from '../ui.js';

// Tipo de politica de exemplo. Modela um alvo de desempenho por celula — um
// caso tipico de otimizacao nao tempo-real conduzida por uma rApp.
//
// O simulador de Near-RT RIC em versao OSC espera o tipo embrulhado em
// { name, description, policy_type_id, create_schema }, e nao o esquema JSON
// diretamente.
const SAMPLE_TYPE_ID = '20008';
const SAMPLE_TYPE_SCHEMA = {
  name: 'alvo-desempenho-celula',
  description: 'Alvo de desempenho por célula aplicado pelo Non-RT RIC via interface A1',
  policy_type_id: 20008,
  create_schema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: '20008',
    type: 'object',
    properties: {
      scope: {
        type: 'object',
        properties: {
          ueId: { type: 'string' },
          cellId: { type: 'string' },
        },
        additionalProperties: false,
        required: ['cellId'],
      },
      qosObjectives: {
        type: 'object',
        properties: {
          gfbr: { type: 'number' },
          priorityLevel: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    required: ['scope'],
  },
};

export async function render(root, ctx) {
  let data = await api('/a1/overview');
  clear(root);

  if (!data.available) {
    root.append(card({
      title: 'Non-RT RIC não está ativo',
      subtitle: 'A interface A1 faz parte do perfil opcional "a1"',
      body: el('div', { class: 'prose' }, [
        el('p', { text: 'O A1 Policy Management Service e o simulador de Near-RT RIC não foram encontrados. Eles sobem com o perfil "a1":' }),
        el('pre', { class: 'code', text: 'cd deploy\ndocker compose --profile a1 up -d' }),
        el('p', { text: 'Depois de os contêineres ficarem saudáveis, recarregue esta tela.' }),
      ]),
    }));
    return () => {};
  }

  const ricBox = el('div');
  const typeBox = el('div');
  const policyBox = el('div');

  // -------------------------------------------------------------------- RICs
  function drawRics() {
    clear(ricBox);
    if (!data.rics.length) {
      ricBox.append(emptyState('Nenhum RIC registrado', 'Verifique application_configuration.json do A1 PMS.'));
      return;
    }
    ricBox.append(table([
      { label: 'RIC', render: (r) => el('span', { style: 'font-weight:600', text: r.ric_id }) },
      { label: 'Estado', render: (r) => {
        const s = String(r.state || '').toUpperCase();
        if (s === 'AVAILABLE') return badge('disponível', 'good', 'good');
        if (s === 'UNAVAILABLE') return badge('indisponível', 'critical', 'critical');
        return badge(r.state || 'desconhecido', 'warning', 'warning');
      } },
      { label: 'Tipos suportados', render: (r) => (r.policytype_ids || []).length
        ? el('div', { class: 'chip-list', style: 'max-height:none' },
            (r.policytype_ids || []).map((t) => el('span', { class: 'chip', text: t || '(sem tipo)' })))
        : el('span', { style: 'font-size:12px;color:var(--text-muted)', text: 'nenhum tipo carregado' }) },
      { label: 'Elementos', render: (r) => el('span', { class: 'mono', text: (r.managed_element_ids || []).join(', ') || '—' }) },
    ], data.rics));
  }

  // --------------------------------------- carregar tipo de politica no RIC
  const seedBtn = el('button', { class: 'btn', type: 'button', text: `Carregar tipo ${SAMPLE_TYPE_ID} no RIC` });
  seedBtn.addEventListener('click', async () => {
    seedBtn.disabled = true;
    try {
      const res = await api('/a1/seed-type', { method: 'POST', body: { typeId: SAMPLE_TYPE_ID, schema: SAMPLE_TYPE_SCHEMA } });
      if (res.ok) {
        toast('Tipo carregado', `O Near-RT RIC agora anuncia o tipo ${SAMPLE_TYPE_ID}. O Non-RT RIC sincroniza em poucos segundos.`, 'ok');
        setTimeout(reload, 4000);
      } else {
        toast('Falha ao carregar tipo', `O RIC retornou HTTP ${res.status}.`, 'err');
      }
    } catch (err) {
      toast('Falha ao carregar tipo', err.message, 'err');
    } finally {
      seedBtn.disabled = false;
    }
  });

  function drawTypes() {
    clear(typeBox);
    if (!data.types.length) {
      typeBox.append(emptyState(
        'Nenhum tipo de política disponível',
        'O simulador de Near-RT RIC sobe sem tipos definidos. Carregue o tipo de exemplo para habilitar a criação de políticas.',
      ));
      return;
    }
    typeBox.append(el('div', { class: 'chip-list', style: 'max-height:none' },
      data.types.map((t) => el('span', { class: 'chip', text: t || '(tipo vazio)' }))));
  }

  // ------------------------------------------------------ criacao de politica
  const policyIdInput = el('input', { type: 'text', value: `pol-${Date.now().toString().slice(-6)}`, 'aria-label': 'Identificador da política' });
  const ricSelect = el('select', { 'aria-label': 'RIC alvo' });
  const typeSelect = el('select', { 'aria-label': 'Tipo de política' });
  const payloadArea = el('textarea', {
    spellcheck: 'false',
    'aria-label': 'Corpo da política em JSON',
    style: 'min-height:150px',
  });
  payloadArea.value = JSON.stringify({ scope: { cellId: 'cell-001' }, qosObjectives: { gfbr: 100, priorityLevel: 5 } }, null, 2);

  function fillSelects() {
    clear(ricSelect).append(...data.rics.map((r) => el('option', { value: r.ric_id, text: r.ric_id })));
    clear(typeSelect).append(...data.types.map((t) => el('option', { value: t, text: t || '(tipo vazio)' })));
    if (!data.types.length) typeSelect.append(el('option', { value: '', text: 'nenhum tipo disponível' }));
  }

  const createBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Criar política' });
  createBtn.addEventListener('click', async () => {
    let policyData;
    try { policyData = JSON.parse(payloadArea.value); }
    catch (err) { toast('JSON inválido', err.message, 'err'); return; }

    createBtn.disabled = true;
    try {
      const res = await api('/a1/policies', {
        method: 'POST',
        body: {
          policyId: policyIdInput.value.trim(),
          ricId: ricSelect.value,
          policyTypeId: typeSelect.value,
          policyData,
        },
      });
      if (res.ok) {
        toast('Política criada', `${policyIdInput.value} entregue ao ${ricSelect.value} pela interface A1.`, 'ok');
        policyIdInput.value = `pol-${Date.now().toString().slice(-6)}`;
        await reload();
      } else {
        toast('Criação recusada', typeof res.data === 'string' ? res.data.slice(0, 160) : `HTTP ${res.status}`, 'err');
      }
    } catch (err) {
      toast('Falha ao criar política', err.message, 'err');
    } finally {
      createBtn.disabled = false;
    }
  });

  // ---------------------------------------------------- politicas existentes
  function drawPolicies() {
    clear(policyBox);
    if (!data.policies.length) {
      policyBox.append(emptyState('Nenhuma política instanciada', 'Crie uma política acima para exercitar a interface A1.'));
      return;
    }
    policyBox.append(table([
      { label: 'Política', render: (p) => el('span', { style: 'font-weight:600', class: 'mono', text: p.id }) },
      { label: 'RIC', render: (p) => p.definition?.ric_id || '—' },
      { label: 'Tipo', render: (p) => p.definition?.policytype_id || '(sem tipo)' },
      { label: 'Serviço', render: (p) => p.definition?.service_id || '—' },
      { label: 'Estado no RIC', render: (p) => {
        // O PMS devolve { last_modified, status: { instance_status, ... } }.
        const st = p.status?.status?.instance_status || p.status?.status?.enforceStatus;
        if (!st) return badge('sem status', 'neutral');
        const pending = String(st).toUpperCase().includes('NOT');
        return badge(String(st), pending ? 'warning' : 'good', pending ? 'warning' : 'good');
      } },
      { label: '', render: (p) => {
        const b = el('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Remover' });
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await api(`/a1/policies/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
            toast('Política removida', `${p.id} foi retirada do RIC.`, 'ok');
            await reload();
          } catch (err) {
            toast('Falha ao remover', err.message, 'err');
            b.disabled = false;
          }
        });
        return b;
      } },
    ], data.policies));
  }

  async function reload() {
    try {
      data = await api('/a1/overview');
      drawRics(); drawTypes(); fillSelects(); drawPolicies();
    } catch { /* mantem a ultima leitura valida */ }
  }

  // ------------------------------------------------------------------ layout
  root.append(card({
    title: 'RICs gerenciados',
    subtitle: 'Near-RT RICs registrados no A1 Policy Management Service',
    body: ricBox,
  }));
  drawRics();

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Tipos de política',
    subtitle: 'Tipos que o Non-RT RIC pode instanciar, descobertos a partir do RIC',
    actions: [seedBtn],
    body: typeBox,
  }));
  drawTypes();

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Nova política A1',
    subtitle: 'A instância é criada no Non-RT RIC e entregue ao Near-RT RIC pela interface A1',
    body: el('div', { class: 'stack' }, [
      el('div', { class: 'form-row' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Identificador' }), policyIdInput]),
        el('div', { class: 'field' }, [el('label', { text: 'RIC alvo' }), ricSelect]),
        el('div', { class: 'field' }, [el('label', { text: 'Tipo de política' }), typeSelect]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Corpo da política' }),
        payloadArea,
        el('span', { class: 'hint', text: 'O conteúdo deve satisfazer o esquema JSON do tipo escolhido.' }),
      ]),
      el('div', { class: 'form-actions' }, [createBtn]),
    ]),
  }));
  fillSelects();

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Políticas instanciadas',
    subtitle: 'Estado consultado no Non-RT RIC e confirmado junto ao Near-RT RIC',
    body: policyBox,
  }));
  drawPolicies();

  const timer = setInterval(reload, 20000);
  return () => clearInterval(timer);
}
