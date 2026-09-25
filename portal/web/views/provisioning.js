// Provisionamento pela interface O1.
//
// O fluxo desta tela e o proprio mecanismo de gerenciamento de configuracao do
// SMO: o SDN-R mantem um mountpoint NETCONF com o elemento, o operador le um
// ramo do datastore (GET RESTCONF -> <get-config> NETCONF), edita o conteudo e
// grava de volta (PUT RESTCONF -> <edit-config> NETCONF). Apos a escrita o
// portal releem o mesmo caminho para evidenciar que o elemento aplicou a
// mudanca.

import { el, api, card, table, badge, emptyState, clear, toast } from '../ui.js';

// Caminhos usuais por tipo de elemento, oferecidos como atalho. O campo aceita
// qualquer caminho YANG, entao a tela nao fica presa a esta lista.
const NTS_VES = 'nts-network-function:simulation/network-function/ves';
const NTS_FAULTS = 'nts-network-function:simulation/network-function/fault-generation';

const SUGGESTIONS = {
  du: [
    { path: NTS_VES, label: 'Telemetria VES (cadência de heartbeat)' },
    { path: NTS_FAULTS, label: 'Padrão de geração de falhas' },
    { path: 'o-ran-sc-du-hello-world:network-function', label: 'Função de rede (O-DU hello world)' },
    { path: 'ietf-interfaces:interfaces', label: 'Interfaces (ietf-interfaces)' },
    { path: 'ietf-hardware:hardware', label: 'Inventário de hardware' },
  ],
  ru: [
    { path: NTS_VES, label: 'Telemetria VES (cadência de heartbeat)' },
    { path: NTS_FAULTS, label: 'Padrão de geração de falhas' },
    { path: 'o-ran-uplane-conf:user-plane-configuration', label: 'Configuração do plano de usuário' },
    { path: 'o-ran-sync:sync', label: 'Sincronismo' },
    { path: 'ietf-interfaces:interfaces', label: 'Interfaces (ietf-interfaces)' },
  ],
};

export async function render(root, ctx) {
  const [nodesRes, baseline] = await Promise.all([
    api('/nodes'),
    api('/provisioning/baseline').catch(() => ({ baseline: [], status: [] })),
  ]);
  clear(root);

  root.append(baselineCard(baseline));
  root.append(el('div', { style: 'height:16px' }));

  const nodes = (nodesRes.nodes || []).filter((n) => String(n.status).toLowerCase() === 'connected');

  if (!nodes.length) {
    root.append(card({
      title: 'Provisionamento indisponível',
      body: emptyState(
        'Nenhum elemento conectado',
        'É preciso ao menos uma função de rede com mountpoint NETCONF ativo. Verifique a tela de Inventário.',
      ),
    }));
    return () => {};
  }

  // ------------------------------------------------------------- controles
  const nodeSelect = el('select', { 'aria-label': 'Elemento de rede' },
    nodes.map((n) => el('option', { value: n.id, text: n.id })));

  const pathInput = el('input', { type: 'text', value: '', placeholder: 'ex.: ietf-interfaces:interfaces', 'aria-label': 'Caminho YANG' });
  const datastoreSelect = el('select', { 'aria-label': 'Datastore' }, [
    el('option', { value: 'config', text: 'config (running)' }),
    el('option', { value: 'operational', text: 'operational (estado)' }),
  ]);

  const suggestionBox = el('div', { class: 'chip-list', style: 'max-height:none' });

  const fillSuggestions = () => {
    const id = nodeSelect.value;
    const node = nodes.find((n) => n.id === id);
    const kind = id.includes('ru') ? 'ru' : 'du';
    const available = new Set((node?.modules || []).map((m) => m.name));

    clear(suggestionBox);
    for (const s of SUGGESTIONS[kind]) {
      const moduleName = s.path.split(':')[0];
      const supported = available.size === 0 || available.has(moduleName);
      const chip = el('button', {
        class: 'chip',
        type: 'button',
        style: `cursor:pointer;${supported ? '' : 'opacity:.45'}`,
        title: supported ? s.label : `${s.label} — módulo não anunciado por este elemento`,
        text: s.path,
      });
      chip.addEventListener('click', () => { pathInput.value = s.path; doRead(); });
      suggestionBox.append(chip);
    }
  };

  nodeSelect.addEventListener('change', () => { fillSuggestions(); clear(resultBox); });
  fillSuggestions();
  pathInput.value = SUGGESTIONS[nodeSelect.value.includes('ru') ? 'ru' : 'du'][0].path;

  const readBtn = el('button', { class: 'btn', type: 'button' }, ['Ler configuração']);
  const writeBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, ['Aplicar configuração']);
  const statusSlot = el('span');

  const editor = el('textarea', {
    spellcheck: 'false',
    'aria-label': 'Conteúdo da configuração em JSON',
    placeholder: 'Leia um caminho para carregar o conteúdo atual do datastore…',
  });

  const resultBox = el('div');

  // --------------------------------------------------------------- leitura
  async function doRead() {
    const node = nodeSelect.value;
    const path = pathInput.value.trim();
    if (!path) { toast('Caminho vazio', 'Informe um caminho YANG para ler.', 'err'); return; }

    readBtn.disabled = true;
    clear(statusSlot).append(badge('lendo…', 'neutral'));
    clear(resultBox);

    try {
      const res = await api(`/nodes/${encodeURIComponent(node)}/config?path=${encodeURIComponent(path)}&datastore=${datastoreSelect.value}`);
      if (res.ok) {
        editor.value = JSON.stringify(res.data, null, 2);
        writeBtn.disabled = datastoreSelect.value !== 'config';
        clear(statusSlot).append(badge(`HTTP ${res.status}`, 'good', 'good'));
        resultBox.append(note(
          `Leitura concluída. O SDN-R traduziu este GET RESTCONF em um <get-config> NETCONF para ${node}.`,
        ));
      } else {
        editor.value = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        writeBtn.disabled = true;
        clear(statusSlot).append(badge(`HTTP ${res.status}`, 'critical', 'critical'));
        const explicacao = {
          404: 'Caminho não encontrado neste elemento. Verifique se o módulo YANG aparece nas capacidades anunciadas (tela de Inventário).',
          409: 'O elemento anuncia este módulo YANG, mas não há dado gravado nesse ramo do datastore (data-missing). Isso é esperado em ramos que o elemento nunca populou — escolha outro caminho ou grave a configuração primeiro.',
        }[res.status] || 'O controlador recusou a leitura. O conteúdo da resposta está no editor.';
        resultBox.append(note(explicacao));
      }
    } catch (err) {
      clear(statusSlot).append(badge('erro', 'critical', 'critical'));
      toast('Falha na leitura', err.message, 'err');
    } finally {
      readBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- escrita
  async function doWrite() {
    const node = nodeSelect.value;
    const path = pathInput.value.trim();

    let payload;
    try {
      payload = JSON.parse(editor.value);
    } catch (err) {
      toast('JSON inválido', err.message, 'err');
      return;
    }

    writeBtn.disabled = true;
    clear(statusSlot).append(badge('aplicando…', 'neutral'));
    clear(resultBox);

    try {
      const res = await api(`/nodes/${encodeURIComponent(node)}/config`, {
        method: 'PUT',
        body: { path, payload },
      });

      const ok = res.write?.ok;
      clear(statusSlot).append(badge(`HTTP ${res.write?.status ?? '—'}`, ok ? 'good' : 'critical', ok ? 'good' : 'critical'));

      if (ok) {
        toast('Configuração aplicada', `${path} gravado em ${node}.`, 'ok');
        resultBox.append(note(
          `Escrita aceita pelo elemento. O SDN-R traduziu este PUT RESTCONF em um <edit-config> NETCONF para ${node}. Abaixo, a releitura do mesmo caminho confirma o estado gravado.`,
        ));
        if (res.verify?.ok) {
          resultBox.append(el('div', { class: 'section-title', style: 'margin-top:14px', text: 'Releitura do datastore' }));
          resultBox.append(el('pre', { class: 'code', text: JSON.stringify(res.verify.data, null, 2) }));
        }
      } else {
        toast('Escrita recusada', `O elemento retornou HTTP ${res.write?.status}.`, 'err');
        resultBox.append(note('O elemento recusou a escrita. A resposta do controlador está abaixo.'));
        resultBox.append(el('pre', { class: 'code', text: JSON.stringify(res.write?.data, null, 2) }));
      }
    } catch (err) {
      clear(statusSlot).append(badge('erro', 'critical', 'critical'));
      toast('Falha na escrita', err.message, 'err');
    } finally {
      writeBtn.disabled = false;
    }
  }

  readBtn.addEventListener('click', doRead);
  writeBtn.addEventListener('click', doWrite);
  datastoreSelect.addEventListener('change', () => { writeBtn.disabled = true; });

  // ----------------------------------------------------------------- layout
  root.append(card({
    title: 'Configuração via interface O1',
    subtitle: 'Leitura e escrita no datastore do elemento, mediadas pelo SDN-R',
    actions: [statusSlot],
    body: el('div', { class: 'stack' }, [
      el('div', { class: 'form-row' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Elemento de rede' }), nodeSelect]),
        el('div', { class: 'field' }, [el('label', { text: 'Caminho YANG' }), pathInput]),
        el('div', { class: 'field' }, [el('label', { text: 'Datastore' }), datastoreSelect]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Caminhos sugeridos para este elemento' }),
        suggestionBox,
        el('span', { class: 'hint', text: 'Atalhos esmaecidos correspondem a módulos que este elemento não anuncia.' }),
      ]),
      el('div', { class: 'form-actions' }, [readBtn, writeBtn]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Conteúdo (JSON conforme RFC 8040)' }),
        editor,
      ]),
      resultBox,
    ]),
  }));

  doRead();

  return () => {};
}

function note(text) {
  return el('p', { style: 'font-size:12.5px;color:var(--text-secondary);margin-top:10px', text });
}

// Cartao do perfil de provisionamento inicial aplicado automaticamente pelo SMO
// a cada elemento assim que ele conecta.
function baselineCard({ baseline = [], status = [] }) {
  const body = el('div', { class: 'stack' });

  body.append(el('div', { class: 'prose', style: 'font-size:12.5px' }, [
    el('p', { html: 'Os simuladores sobem com os parâmetros de telemetria vazios: conectam pela interface O1, mas não reportam nada. O SMO aplica este perfil em cada elemento assim que ele conecta — um <code>&lt;edit-config&gt;</code> por item, seguido de releitura de confirmação.' }),
  ]));

  body.append(table([
    { label: 'Item', render: (b) => el('span', {}, [
      el('div', { style: 'font-weight:600', text: b.label }),
      el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: b.description }),
    ]) },
    { label: 'Caminho YANG', mono: true, key: 'path' },
  ], baseline));

  if (status.length) {
    body.append(el('div', { class: 'section-title', style: 'margin-top:6px', text: 'Aplicação por elemento' }));
    body.append(table([
      { label: 'Elemento', render: (s) => el('span', { style: 'font-weight:600', text: s.node }) },
      { label: 'Resultado', render: (s) => s.ok
        ? badge('perfil aplicado', 'good', 'good')
        : badge('aplicação incompleta', 'critical', 'critical') },
      { label: 'Etapas', render: (s) => el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' },
          s.steps.map((st) => badge(`${st.label} · ${st.status}`, st.ok ? 'good' : 'critical', st.ok ? 'good' : 'critical'))) },
      { label: 'Quando', render: (s) => el('span', { style: 'font-size:12px;color:var(--text-secondary);white-space:nowrap',
          text: new Date(s.appliedAt).toLocaleTimeString('pt-BR') }) },
      { label: '', render: (s) => {
        const b = el('button', { class: 'btn btn-sm', type: 'button', text: 'Reaplicar' });
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const res = await api(`/provisioning/baseline/${encodeURIComponent(s.node)}`, { method: 'POST' });
            toast(res.ok ? 'Perfil reaplicado' : 'Reaplicação incompleta',
              `${s.node}: ${res.steps.filter((x) => x.ok).length}/${res.steps.length} etapas aceitas.`,
              res.ok ? 'ok' : 'err');
            setTimeout(() => location.reload(), 800);
          } catch (err) {
            toast('Falha ao reaplicar', err.message, 'err');
            b.disabled = false;
          }
        });
        return b;
      } },
    ], status));
  } else {
    body.append(emptyState('Nenhum elemento provisionado ainda', 'O reconciliador aplica o perfil poucos segundos após cada elemento conectar.'));
  }

  return card({
    title: 'Perfil de provisionamento inicial',
    subtitle: 'Aplicado automaticamente pelo SMO via interface O1 quando o elemento conecta',
    body,
  });
}
