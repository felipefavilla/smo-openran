// Guia de apoio ao uso da aplicacao, embutido no proprio portal.

import { el, card, clear } from '../ui.js';

export async function render(root, ctx) {
  clear(root);
  const links = ctx.config.links || {};

  root.append(card({
    title: 'O que é este portal',
    subtitle: 'Camada de operação sobre os componentes oficiais do SMO',
    body: el('div', { class: 'prose' }, [
      el('p', { html: 'Este portal <strong>não reimplementa funções de SMO</strong>. Ele consome as APIs dos componentes oficiais da O-RAN Software Community e os apresenta numa interface única de operação:' }),
      el('ul', {}, [
        el('li', { html: '<strong>SDN-R (OpenDaylight)</strong> — inventário e configuração dos elementos, via RESTCONF sobre os mountpoints NETCONF da interface O1.' }),
        el('li', { html: '<strong>VES Collector</strong> — telemetria e alarmes, consumidos dos tópicos Kafka em que o coletor publica os eventos da interface O1.' }),
        el('li', { html: '<strong>A1 Policy Management Service</strong> — políticas do Non-RT RIC entregues ao Near-RT RIC pela interface A1.' }),
        el('li', { html: '<strong>Docker Engine API</strong> — ciclo de vida das funções de rede no perfil leve da implementação.' }),
      ]),
      el('p', { html: 'A interface oficial do controlador, o <strong>ODLUX</strong>, continua disponível em paralelo e é a referência para operações avançadas sobre o SDN-R.' }),
    ]),
  }));

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Primeiro acesso',
    subtitle: 'O que esperar nos primeiros minutos após subir a pilha',
    body: el('div', { class: 'prose' }, [
      el('ol', {}, [
        el('li', { html: 'O <strong>SDN-R</strong> leva de 3 a 5 minutos para ficar saudável — o OpenDaylight carrega dezenas de módulos na primeira subida.' }),
        el('li', { html: 'Em seguida as funções de rede simuladas enviam o <strong>registro de PNF</strong> pela interface O1 (evento VES) e fazem <strong>NETCONF Call Home</strong> para o controlador.' }),
        el('li', { html: 'Quando o mountpoint é estabelecido, o elemento aparece em <strong>Inventário</strong> com estado <em>conectado</em> e a lista de módulos YANG que anuncia.' }),
        el('li', { html: 'A partir daí chegam <strong>heartbeats</strong>, <strong>medições</strong> e eventualmente <strong>alarmes</strong>, visíveis em Desempenho e Falhas.' }),
      ]),
      el('p', { html: 'Se após cinco minutos a tela de Inventário continuar vazia, consulte a seção de diagnóstico no final desta página.' }),
    ]),
  }));

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'As telas, uma a uma',
    body: el('div', { class: 'prose' }, [
      el('h3', { text: 'Visão geral' }),
      el('p', { text: 'Estado consolidado: quantas funções de rede estão conectadas, quantos alarmes estão ativos, quantos eventos já foram recebidos e o fluxo de eventos por minuto separado por domínio. O diagrama de topologia mostra cada aresta O1 com a cor do estado real da conexão.' }),

      el('h3', { text: 'Inventário e topologia' }),
      el('p', { text: 'Um cartão por elemento montado no controlador, com endereço, estado da conexão e a lista completa de módulos YANG que o elemento anuncia. Essa lista é a evidência do mecanismo de descoberta de capacidade da interface O1. O campo de filtro ajuda a localizar um módulo específico entre centenas.' }),

      el('h3', { text: 'Provisionamento O1' }),
      el('p', { html: 'A tela onde a configuração é efetivamente aplicada. Escolha o elemento, informe um caminho YANG (ou use um dos atalhos), clique em <strong>Ler configuração</strong> para trazer o conteúdo atual do datastore, edite o JSON e clique em <strong>Aplicar configuração</strong>.' }),
      el('p', { html: 'Por baixo: o GET vira um <code>&lt;get-config&gt;</code> NETCONF e o PUT vira um <code>&lt;edit-config&gt;</code>, ambos emitidos pelo SDN-R para o elemento. Após a escrita o portal relê o mesmo caminho e mostra o resultado — é essa releitura que comprova que o elemento aplicou a mudança.' }),
      el('p', { html: 'Os atalhos são <strong>sondados no próprio elemento</strong> quando a tela abre, e ordenados pelo resultado: em destaque os que têm configuração gravada, esmaecidos os ramos vazios (HTTP 409), e mais claros ainda os módulos que o elemento não anuncia (HTTP 400). Passe o cursor sobre um atalho para ver o motivo. A tela já abre com um caminho que tem conteúdo.' }),

      el('h3', { text: 'Gerenciamento de falhas' }),
      el('p', { html: 'Alarmes correntes construídos a partir dos eventos VES de domínio <em>fault</em>. Um alarme é encerrado automaticamente quando o elemento reenvia a mesma condição com severidade <code>NORMAL</code>. O botão <strong>Reconhecer</strong> marca o alarme como tratado sem removê-lo da lista. Os filtros no topo do cartão alternam entre ativos, limpos e todos.' }),

      el('h3', { text: 'Desempenho e telemetria' }),
      el('p', { text: 'Vazão de eventos por minuto empilhada por domínio, com janelas de 15, 30 ou 60 minutos; distribuição de eventos por elemento; séries temporais dos indicadores numéricos encontrados nos eventos de medição; e a lista dos eventos mais recentes. Passe o cursor sobre qualquer gráfico para ver os valores exatos.' }),

      el('h3', { text: 'Políticas A1' }),
      el('p', { html: 'Disponível apenas com o perfil <code>a1</code> ativo. O simulador de Near-RT RIC sobe sem nenhum tipo de política definido — por isso o primeiro passo é clicar em <strong>Carregar tipo 20008 no RIC</strong>. Em poucos segundos o Non-RT RIC sincroniza e o tipo passa a aparecer. A partir daí é possível criar instâncias de política e acompanhar o estado de aplicação reportado pelo próprio RIC.' }),
      el('p', { html: 'O botão é seguro de clicar mais de uma vez: se o tipo já estiver no RIC, a tela informa e não tenta regravá-lo — o simulador recusaria a redefinição enquanto houvesse instâncias daquele tipo.' }),

      el('h3', { text: 'Ciclo de vida de NF' }),
      el('p', { html: 'Iniciar, parar e reiniciar as funções de rede, além de inspecionar os logs de qualquer contêiner. Pare uma NF e observe, na mesma linha, a coluna NETCONF mudar para desconectado em poucos segundos — o acoplamento entre ciclo de vida e interface O1 fica visível. As ações são restritas às NFs; os componentes da plataforma aparecem apenas para diagnóstico.' }),
    ]),
  }));

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Roteiro de demonstração',
    subtitle: 'Sequência sugerida para mostrar a solução funcionando',
    body: el('div', { class: 'prose' }, [
      el('ol', {}, [
        el('li', { html: 'Abra <strong>Visão geral</strong> e confirme as funções de rede conectadas e o fluxo de eventos ativo.' }),
        el('li', { html: 'Vá a <strong>Inventário</strong> e mostre os módulos YANG anunciados por um O-RU — a descoberta de capacidade da interface O1.' }),
        el('li', { html: 'Em <strong>Provisionamento O1</strong>, leia um caminho, altere um valor, aplique e mostre a releitura confirmando a gravação.' }),
        el('li', { html: 'Em <strong>Ciclo de vida</strong>, pare um O-RU e volte à <strong>Visão geral</strong>: a aresta O1 correspondente fica vermelha no diagrama.' }),
        el('li', { html: 'Reinicie o O-RU e acompanhe o novo registro de PNF chegando em <strong>Desempenho</strong>.' }),
        el('li', { html: 'Em <strong>Políticas A1</strong>, carregue o tipo, crie uma política e mostre o estado confirmado pelo Near-RT RIC.' }),
      ]),
      el('p', { html: 'O script <code>deploy/scripts/demo.sh</code> executa essa mesma sequência pela linha de comando e imprime o resultado de cada passo.' }),
    ]),
  }));

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Diagnóstico',
    subtitle: 'O que verificar quando algo não aparece',
    body: el('div', { class: 'prose' }, [
      el('h3', { text: 'Nenhum elemento em Inventário' }),
      el('p', { html: 'Verifique se o controlador está saudável: <code>docker compose ps controller</code>. Se estiver, consulte os logs de um simulador em <strong>Ciclo de vida → Logs</strong> e procure por mensagens de Call Home. Como alternativa ao Call Home, o registro manual do mountpoint está disponível na API do portal.' }),

      el('h3', { text: 'Nenhum evento em Desempenho' }),
      el('p', { html: 'O indicador no rodapé do menu lateral mostra o estado do fluxo ao vivo. Se estiver reconectando, verifique <code>docker compose logs kafka</code> e <code>docker compose logs ves-collector</code>.' }),

      el('h3', { text: 'Tela de Políticas A1 indisponível' }),
      el('p', { html: 'O perfil A1 é opcional. Suba-o com <code>docker compose --profile a1 up -d</code> a partir do diretório <code>deploy</code>.' }),

      el('h3', { text: 'O portal não reflete uma mudança recente' }),
      el('p', { html: 'Os módulos são servidos com revalidação obrigatória e o portal recarrega sozinho quando percebe que o servidor passou a servir código novo. Se ainda assim a tela parecer antiga, force a recarga com <code>Ctrl+Shift+R</code>.' }),

      el('h3', { text: 'Escrita recusada no Provisionamento' }),
      el('p', { html: 'Um HTTP 400 indica que o elemento não anuncia aquele módulo YANG; 409 com <code>data-missing</code> indica módulo anunciado mas sem dado gravado naquele ramo — situação normal, não um erro. A resposta completa do controlador é exibida abaixo do editor.' }),
    ]),
  }));

  root.append(el('div', { style: 'height:16px' }));

  root.append(card({
    title: 'Interfaces externas',
    subtitle: 'Componentes oficiais acessíveis diretamente',
    body: el('div', { class: 'prose' }, [
      el('ul', {}, [
        el('li', {}, [
          el('a', { href: links.odlux || '#', target: '_blank', rel: 'noopener', text: 'ODLUX' }),
          ' — interface web oficial do SDN-R. Usuário ',
          el('code', { text: 'admin' }),
          '.',
        ]),
        el('li', {}, [
          el('a', { href: links.ves || '#', target: '_blank', rel: 'noopener', text: 'VES Collector' }),
          ' — coletor de eventos da interface O1. Os eventos são entregues por ',
          el('code', { text: 'POST /eventListener/v7' }),
          '; a raiz responde apenas com uma página de estado.',
        ]),
      ]),
    ]),
  }));

  return () => {};
}
