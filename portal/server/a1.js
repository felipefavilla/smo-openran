// Cliente do A1 Policy Management Service (Non-RT RIC) e do simulador de
// Near-RT RIC. Cobre o ciclo completo de uma politica A1: descobrir os RICs
// gerenciados, listar os tipos de politica que cada um suporta, criar, consultar
// e remover instancias.

import { config } from './config.js';

async function call(base, path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const pms = (path, opts) => call(config.a1.pmsBaseUrl, path, opts);
const ric = (path, opts) => call(config.a1.ricBaseUrl, path, opts);

export const a1 = {
  async status() {
    const res = await pms('/a1-policy/v2/status');
    return { available: res.ok, status: res.status, data: res.data };
  },

  async rics() {
    const res = await pms('/a1-policy/v2/rics');
    return { ok: res.ok, status: res.status, rics: res.data?.rics || [], error: res.ok ? null : res.data };
  },

  // Atencao a grafia: o PMS devolve "policytype_ids", sem separador entre
  // policy e type — diferente de "policy_type_id" usado no corpo das politicas.
  async policyTypes(ricId) {
    const q = ricId ? `?ric_id=${encodeURIComponent(ricId)}` : '';
    const res = await pms(`/a1-policy/v2/policy-types${q}`);
    return { ok: res.ok, status: res.status, types: res.data?.policytype_ids || [], error: res.ok ? null : res.data };
  },

  async policyTypeSchema(typeId) {
    const res = await pms(`/a1-policy/v2/policy-types/${encodeURIComponent(typeId)}`);
    return { ok: res.ok, status: res.status, schema: res.data?.policy_schema || null };
  },

  // O endpoint devolve as instancias completas em "policies", nao uma lista de
  // identificadores — nao e preciso buscar cada politica em separado.
  async policies() {
    const res = await pms('/a1-policy/v2/policy-instances');
    const lista = res.data?.policies || [];
    return {
      ok: res.ok,
      status: res.status,
      policies: lista,
      ids: lista.map((p) => p.policy_id),
      error: res.ok ? null : res.data,
    };
  },

  async policy(policyId) {
    const [def, status] = await Promise.all([
      pms(`/a1-policy/v2/policies/${encodeURIComponent(policyId)}`),
      pms(`/a1-policy/v2/policies/${encodeURIComponent(policyId)}/status`),
    ]);
    return { ok: def.ok, definition: def.data, status: status.data };
  },

  // Estado de aplicacao de cada instancia, consultado no RIC pelo PMS.
  async policyStatus(policyId) {
    const res = await pms(`/a1-policy/v2/policies/${encodeURIComponent(policyId)}/status`);
    return res.data;
  },

  async createPolicy({ policyId, ricId, policyTypeId, policyData, serviceId = 'smo-portal' }) {
    return pms('/a1-policy/v2/policies', {
      method: 'PUT',
      body: {
        policy_id: policyId,
        ric_id: ricId,
        policytype_id: policyTypeId || '',
        service_id: serviceId,
        policy_data: policyData,
      },
    });
  },

  async deletePolicy(policyId) {
    return pms(`/a1-policy/v2/policies/${encodeURIComponent(policyId)}`, { method: 'DELETE' });
  },

  // Consulta o proprio Near-RT RIC, para evidenciar que a politica foi realmente
  // entregue pela interface A1 e nao apenas registrada no Non-RT RIC.
  async ricPolicyTypes() {
    const res = await ric('/a1-p/policytypes');
    return { ok: res.ok, status: res.status, data: res.data };
  },

  async ricPolicies(typeId) {
    const res = await ric(`/a1-p/policytypes/${encodeURIComponent(typeId)}/policies`);
    return { ok: res.ok, status: res.status, data: res.data };
  },

  // Carrega um tipo de politica no simulador de Near-RT RIC. O simulador sobe
  // sem tipos definidos; o Non-RT RIC so consegue instanciar politicas de tipos
  // que o RIC ja anuncia.
  async seedPolicyType(typeId, schema) {
    return ric(`/policytype?id=${encodeURIComponent(typeId)}`, { method: 'PUT', body: schema });
  },

  // Garante que o tipo esteja disponivel, sem tentar regrava-lo a toa.
  //
  // O simulador recusa redefinir um tipo que ja tenha instancias de politica
  // ("The policy type already exists and instances exists", HTTP 400). Como o
  // botao da tela e idempotente do ponto de vista do operador, a verificacao
  // vem antes da escrita, e a recusa e traduzida em algo acionavel.
  async ensurePolicyType(typeId, schema) {
    const atuais = await this.ricPolicyTypes();
    const anunciados = Array.isArray(atuais.data) ? atuais.data.map(String) : [];

    if (anunciados.includes(String(typeId))) {
      return { ok: true, status: 200, already: true, data: `O tipo ${typeId} já está disponível no RIC.` };
    }

    const res = await this.seedPolicyType(typeId, schema);
    if (!res.ok && typeof res.data === 'string' && res.data.includes('instances exists')) {
      return {
        ...res,
        already: false,
        hint: `Há instâncias de política do tipo ${typeId} no RIC. Remova-as antes de redefinir o tipo.`,
      };
    }
    return { ...res, already: false };
  },
};
