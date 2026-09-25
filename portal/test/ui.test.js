// Testes de interface do portal num navegador real.
//
// Carrega cada tela, verifica que ela renderiza sem erro de console e exercita
// as acoes principais. Complementa api.test.js: aqui o que se testa e o codigo
// do frontend, incluindo os modulos de grafico e o roteador.
//
//   npm run test:ui
//
// Requer puppeteer-core e um Chrome instalado. Sem eles a suite e ignorada, o
// que mantem `npm test` utilizavel em maquinas sem navegador.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.PORTAL_URL || 'http://localhost:8080';
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let puppeteer = null;
let browser = null;
let indisponivel = null;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  try {
    ({ default: puppeteer } = await import('puppeteer-core'));
  } catch {
    indisponivel = 'puppeteer-core não instalado (npm i -D puppeteer-core)';
    return;
  }
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    indisponivel = `não foi possível iniciar o Chrome em ${CHROME}: ${err.message}`;
  }
});

after(async () => {
  if (browser) await browser.close();
});

// Abre uma tela e devolve a pagina junto com os erros que o navegador registrou.
async function abrir(rota, { esperarMs = 3500 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const erros = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  page.on('pageerror', (err) => erros.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    // O EventSource e abortado na navegacao; nao conta como falha.
    if (!req.url().includes('/api/stream')) erros.push(`request falhou: ${req.url()}`);
  });

  await page.goto(`${BASE}/#/${rota}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await esperar(esperarMs);
  return { page, erros };
}

const TELAS = [
  ['overview', 'Visão geral'],
  ['inventory', 'Inventário e topologia'],
  ['provisioning', 'Provisionamento O1'],
  ['faults', 'Gerenciamento de falhas'],
  ['performance', 'Desempenho e telemetria'],
  ['policies', 'Políticas A1'],
  ['lifecycle', 'Ciclo de vida de NF'],
  ['help', 'Ajuda'],
];

describe('Carga de todas as telas', () => {
  for (const [rota, titulo] of TELAS) {
    test(`${rota} renderiza sem erro`, async (t) => {
      if (indisponivel) return t.skip(indisponivel);

      const { page, erros } = await abrir(rota);
      try {
        const tituloVisivel = await page.$eval('#view-title', (n) => n.textContent.trim());
        assert.equal(tituloVisivel, titulo);

        // O indicador de carregamento nao pode ficar preso.
        const carregando = await page.$('#conteudo .loading');
        assert.equal(carregando, null, 'a tela ficou presa em "Carregando…"');

        // A casca de erro do roteador nao pode aparecer.
        const falhou = await page.$$eval('#conteudo .empty strong',
          (ns) => ns.map((n) => n.textContent));
        assert.ok(!falhou.some((t) => t.includes('Não foi possível carregar')),
          `a tela devolveu erro: ${falhou.join(' | ')}`);

        // Toda tela precisa produzir ao menos um cartao.
        const cartoes = await page.$$eval('#conteudo .card', (ns) => ns.length);
        assert.ok(cartoes > 0, 'nenhum cartão renderizado');

        assert.deepEqual(erros, [], `erros de console: ${erros.join(' | ')}`);
      } finally {
        await page.close();
      }
    });
  }
});

describe('Visão geral', () => {
  test('mostra indicadores, gráfico empilhado e topologia', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('overview');
    try {
      const tiles = await page.$$eval('.tile-value', (ns) => ns.map((n) => n.textContent.trim()));
      assert.equal(tiles.length, 4, 'os quatro indicadores precisam aparecer');
      assert.match(tiles[0], /^\d+\/\d+$/, 'o primeiro indicador é a razão de NFs conectadas');

      const barras = await page.$$eval('#conteudo .chart path[fill]', (ns) => ns.length);
      assert.ok(barras > 0, 'o gráfico de eventos não desenhou nenhuma barra');

      const nosTopologia = await page.$$eval('.topology .node-label', (ns) => ns.map((n) => n.textContent));
      assert.ok(nosTopologia.some((t) => t.includes('SMO')), 'o SMO não aparece na topologia');
      assert.ok(nosTopologia.some((t) => t.startsWith('o-')), 'nenhum elemento na topologia');
    } finally {
      await page.close();
    }
  });
});

describe('Inventário', () => {
  test('lista módulos YANG limpos, sem URNs de protocolo', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('inventory');
    try {
      const chips = await page.$$eval('.chip', (ns) => ns.map((n) => n.textContent.trim()));
      assert.ok(chips.length > 0, 'nenhum módulo listado');
      assert.ok(!chips.some((c) => c.startsWith('urn:')),
        'capacidade de protocolo aparecendo como módulo YANG');
    } finally {
      await page.close();
    }
  });

  test('o filtro de módulos reduz a lista', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('inventory');
    try {
      const antes = await page.$$eval('.chip', (ns) => ns.length);
      await page.type('input[placeholder="filtrar módulos YANG…"]', 'o-ran');
      await esperar(400);
      const depois = await page.$$eval('.chip', (ns) => ns.length);
      assert.ok(depois < antes, 'o filtro não reduziu a lista');
      assert.ok(depois > 0, 'o filtro zerou uma busca que deveria ter resultados');
    } finally {
      await page.close();
    }
  });
});

describe('Provisionamento O1', () => {
  test('pré-carrega um caminho legível e mostra HTTP 200', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('provisioning', { esperarMs: 7000 });
    try {
      const selo = await page.$$eval('.card-head-actions .badge',
        (ns) => ns.map((n) => n.textContent.trim()));
      assert.ok(selo.some((s) => s.includes('200')),
        `a tela abriu com erro de leitura: ${selo.join(' | ')}`);

      const editor = await page.$eval('textarea', (n) => n.value);
      assert.ok(editor.trim().startsWith('{'), 'o editor não carregou o datastore');
    } finally {
      await page.close();
    }
  });

  test('os caminhos sugeridos estão sondados e o primeiro é legível', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('provisioning', { esperarMs: 7000 });
    try {
      const chips = await page.$$eval('.chip-list .chip',
        (ns) => ns.map((n) => ({ texto: n.textContent.trim(), titulo: n.getAttribute('title') || '' })));
      assert.ok(chips.length > 0, 'nenhum caminho sugerido');
      assert.ok(chips.every((c) => /HTTP \d{3}/.test(c.titulo)),
        'cada sugestão precisa informar o resultado da sondagem');
      assert.match(chips[0].titulo, /há configuração gravada/,
        'o primeiro caminho sugerido tem de ter conteúdo');
    } finally {
      await page.close();
    }
  });

  test('o perfil de provisionamento aparece aplicado', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('provisioning', { esperarMs: 7000 });
    try {
      const selos = await page.$$eval('#conteudo .badge',
        (ns) => ns.map((n) => n.textContent.trim()));
      assert.ok(selos.filter((s) => s === 'perfil aplicado').length >= 1,
        'nenhum elemento com o perfil aplicado');
      assert.ok(!selos.some((s) => s.includes('incompleta')),
        'há elemento com perfil incompleto');
    } finally {
      await page.close();
    }
  });
});

describe('Falhas', () => {
  test('mostra o resumo por severidade e a tabela de alarmes', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('faults');
    try {
      const tiles = await page.$$eval('.tile-label', (ns) => ns.map((n) => n.textContent));
      assert.ok(tiles.includes('Alarmes ativos'));
      assert.ok(tiles.includes('Críticos'));

      const temTabelaOuVazio = await page.$$eval('#conteudo table.data, #conteudo .empty',
        (ns) => ns.length);
      assert.ok(temTabelaOuVazio > 0, 'nem tabela nem estado vazio');
    } finally {
      await page.close();
    }
  });

  test('os filtros de estado alternam sem erro', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page, erros } = await abrir('faults');
    try {
      for (const rotulo of ['Limpos', 'Todos', 'Ativos']) {
        const botao = await page.$$eval('.card-head-actions .btn',
          (ns, r) => { const b = ns.find((n) => n.textContent.trim() === r); if (b) b.click(); return !!b; },
          rotulo);
        assert.ok(botao, `filtro "${rotulo}" não encontrado`);
        await esperar(1200);
      }
      assert.deepEqual(erros, [], `erros ao filtrar: ${erros.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
});

describe('Desempenho', () => {
  test('desenha o gráfico empilhado e as séries de KPI', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('performance', { esperarMs: 5000 });
    try {
      const svgs = await page.$$eval('#conteudo svg.chart', (ns) => ns.length);
      assert.ok(svgs >= 2, `esperado ao menos dois gráficos, veio ${svgs}`);

      const linhas = await page.$$eval('#conteudo svg.chart path[stroke-width="2"]', (ns) => ns.length);
      assert.ok(linhas > 0, 'nenhuma série temporal desenhada — os KPIs não chegaram');

      const rotulos = await page.$$eval('#conteudo .card-head h2', (ns) => ns.map((n) => n.textContent));
      assert.ok(!rotulos.some((r) => r.includes('/o-ran-sc-du-hello-world')),
        'rótulo de KPI não tratado aparecendo como título');
    } finally {
      await page.close();
    }
  });

  test('as janelas de tempo alternam sem erro', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page, erros } = await abrir('performance', { esperarMs: 4000 });
    try {
      for (const rotulo of ['15 min', '30 min', '60 min']) {
        await page.$$eval('.card-head-actions .btn',
          (ns, r) => { const b = ns.find((n) => n.textContent.trim() === r); if (b) b.click(); },
          rotulo);
        await esperar(1500);
      }
      assert.deepEqual(erros, [], `erros ao trocar janela: ${erros.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
});

describe('Políticas A1', () => {
  test('carregar o tipo no RIC não devolve erro', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('policies', { esperarMs: 4000 });
    try {
      const botao = await page.$$eval('.btn',
        (ns) => { const b = ns.find((n) => n.textContent.includes('Carregar tipo')); if (b) b.click(); return !!b; });
      if (!botao) return t.skip('perfil a1 inativo');

      await esperar(4000);
      const avisos = await page.$$eval('.toast', (ns) => ns.map((n) => n.textContent));
      assert.ok(!avisos.some((a) => a.includes('Falha') || a.includes('HTTP 400')),
        `a carga do tipo falhou: ${avisos.join(' | ')}`);
      assert.ok(avisos.some((a) => a.includes('Tipo carregado') || a.includes('Tipo já disponível')),
        `esperado aviso de sucesso, veio: ${avisos.join(' | ')}`);
    } finally {
      await page.close();
    }
  });

  test('a tabela de RICs mostra o RIC disponível', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('policies', { esperarMs: 4000 });
    try {
      const corpo = await page.$eval('#conteudo', (n) => n.textContent);
      if (corpo.includes('Non-RT RIC não está ativo')) return t.skip('perfil a1 inativo');
      assert.match(corpo, /disponível/, 'o RIC não aparece como disponível');
    } finally {
      await page.close();
    }
  });
});

describe('Ciclo de vida', () => {
  test('lista as NFs com ações e a plataforma sem elas', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('lifecycle', { esperarMs: 4000 });
    try {
      const botoes = await page.$$eval('#conteudo .btn', (ns) => ns.map((n) => n.textContent.trim()));
      assert.ok(botoes.includes('Parar'), 'faltam ações de ciclo de vida nas NFs');
      assert.ok(botoes.includes('Logs'));

      // A tabela da plataforma nao pode ter acoes.
      const tabelas = await page.$$eval('#conteudo table.data',
        (ns) => ns.map((t) => t.textContent));
      const plataforma = tabelas[tabelas.length - 1];
      assert.ok(!plataforma.includes('Parar'),
        'os componentes da plataforma não podem expor ação de parada');
    } finally {
      await page.close();
    }
  });

  test('abrir os logs de uma NF funciona', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('lifecycle', { esperarMs: 4000 });
    try {
      await page.$$eval('#conteudo .btn',
        (ns) => { const b = ns.find((n) => n.textContent.trim() === 'Logs'); if (b) b.click(); });
      await esperar(3500);
      const pre = await page.$('#conteudo pre.code');
      assert.ok(pre, 'os logs não foram exibidos');
    } finally {
      await page.close();
    }
  });
});

describe('Navegação e tema', () => {
  test('o menu lateral navega entre todas as telas', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page, erros } = await abrir('overview');
    try {
      for (const [rota, titulo] of TELAS) {
        await page.click(`.nav-item[data-view="${rota}"]`);
        await esperar(2500);
        const atual = await page.$eval('#view-title', (n) => n.textContent.trim());
        assert.equal(atual, titulo, `a navegação para ${rota} não trocou o título`);
      }
      assert.deepEqual(erros, [], `erros durante a navegação: ${erros.join(' | ')}`);
    } finally {
      await page.close();
    }
  });

  test('o tema alterna entre claro e escuro', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('overview');
    try {
      await page.click('#theme-btn');
      await esperar(1500);
      const tema = await page.$eval('html', (n) => n.dataset.theme);
      assert.ok(['dark', 'light'].includes(tema), 'o tema não foi fixado no elemento raiz');
    } finally {
      await page.close();
    }
  });

  test('os links externos apontam para endpoints que respondem a GET', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('overview');
    try {
      const links = await page.$$eval('.ext-links a', (ns) => ns.map((n) => n.href));
      assert.equal(links.length, 2);

      for (const url of links) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        assert.ok(res.status < 400,
          `${url} respondeu HTTP ${res.status} — o link levaria a uma página de erro`);
      }
    } finally {
      await page.close();
    }
  });

  test('o indicador de fluxo ao vivo fica ativo', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const { page } = await abrir('overview', { esperarMs: 5000 });
    try {
      const estado = await page.$eval('#conn-state', (n) => n.dataset.state);
      assert.equal(estado, 'live', 'o SSE não conectou');
    } finally {
      await page.close();
    }
  });

  test('a interface se adapta à largura de telefone sem rolagem horizontal', async (t) => {
    if (indisponivel) return t.skip(indisponivel);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 400, height: 860 });
      await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle2', timeout: 60000 });
      await esperar(4000);

      const excesso = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(excesso <= 1, `a página rola ${excesso}px na horizontal a 400px de largura`);
    } finally {
      await page.close();
    }
  });
});
