# Changelog

Registro das mudanças do projeto, da mais recente para a mais antiga.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versões seguem [SemVer](https://semver.org/lang/pt-BR/).

---

## [1.1.0] — 2026-09-25

Correção de três defeitos encontrados em uso e introdução de uma suíte de testes
que passou a cobrir todas as funcionalidades do portal. Dois dos defeitos foram
descobertos pelos próprios testes, não em uso manual.

### Adicionado

- **Suíte de testes do portal** (`portal/test/`), com 87 casos e sem mocks: cada
  teste exercita o caminho real até o componente oficial correspondente.
  - `api.test.js` — 60 casos sobre a API: saúde, arquivos estáticos e cabeçalhos
    de cache, visão geral, inventário, provisionamento O1 (leitura, escrita e
    releitura de confirmação), falhas (incluindo injeção de evento VES e sua
    propagação até o portal), desempenho e SSE, políticas A1 (ciclo completo) e
    ciclo de vida de NF (incluindo a queda e o restabelecimento do mountpoint).
  - `ui.test.js` — 27 casos num Chrome de verdade: carga das oito telas sem erro
    de console, interações principais de cada uma, navegação, tema, links
    externos e ausência de rolagem horizontal a 400 px.
  - Executáveis com `npm test`, `npm run test:ui` e `npm run test:all`. Sem
    dependências além do `node:test` nativo; os testes de interface exigem
    `puppeteer-core` e são ignorados se ele não estiver instalado.
- **Sondagem dos caminhos de configuração** (`portal/server/suggestions.js`):
  novo endpoint `GET /api/nodes/:id/suggestions`, que tenta ler cada caminho
  candidato no próprio elemento e classifica o resultado em legível, vazio ou
  ausente.
- **Identificador de build** em `/api/health` e `/api/config`. O portal compara
  o identificador periodicamente e recarrega a página quando detecta que o
  servidor passou a servir código novo.
- **Carga idempotente de tipo de política A1** (`a1.ensurePolicyType`): verifica
  antes de gravar e traduz a recusa do simulador em uma orientação acionável.

### Corrigido

- **Tela de Políticas A1 nunca listava tipos nem instâncias.** O cliente lia
  `policy_type_ids` e `policy_ids`, mas o A1 Policy Management Service devolve
  `policytype_ids` e um array `policies` com as instâncias completas. Em
  consequência, o seletor de tipo ficava vazio e a tabela de políticas nunca
  mostrava nada, mesmo com políticas ativas no RIC. Descoberto pelos testes.
- **Carregar o tipo de política podia falhar com HTTP 400.** O simulador de
  Near-RT RIC recusa redefinir um tipo que já tenha instâncias
  (`The policy type already exists and instances exists`). O botão agora
  verifica antes de gravar e, quando a recusa ocorre, explica o motivo em vez de
  mostrar apenas o código HTTP. Reproduzido pelos testes de interface.
- **Quatro dos cinco caminhos sugeridos em Provisionamento O1 não existiam** nos
  elementos: retornavam 400 no O-DU e 409 no O-RU. A lista era fixa e nunca
  verificada. Agora os caminhos são sondados no elemento e a tela pré-carrega um
  que tenha conteúdo.
- **O link do VES Collector levava a uma página de erro.** Apontava para
  `/eventListener/v7`, que só aceita POST e responde 405 a uma navegação. Passou
  a apontar para a raiz do coletor.
- **Módulos do frontend podiam ficar em cache entre builds.** Sem nomes
  versionados, um navegador com a aba aberta continuava executando o código
  anterior depois de um novo build — o que fez dois defeitos já corrigidos
  parecerem persistentes. Os módulos passaram a ser servidos com `no-cache` e a
  casca da SPA com `no-store`.
- Leitura de capacidade de protocolo exibida como módulo YANG no inventário; as
  duas classes agora são separadas na leitura do controlador.

### Alterado

- Os itens do perfil de provisionamento e os textos da tela de Provisionamento
  passaram a descrever os três estados possíveis de um caminho sondado.

---

## [1.0.0] — 2026-09-24

Implementação inicial da Parte 2: pilha SMO da O-RAN Software Community
provisionando e gerenciando uma pilha Open RAN simulada, com portal de operação
próprio.

### Adicionado

- **Pilha SMO** (`deploy/docker-compose.yaml`) com dez imagens oficiais da
  O-RAN SC e do ONAP, fixadas na M-Release do projeto OAM:
  - SDN-R (OpenDaylight) com ODLUX — cliente NETCONF da interface O1;
  - VES Collector (ONAP) — ingestão de eventos da O1;
  - Kafka e ZooKeeper (Strimzi) — barramento de eventos do SMO;
  - MariaDB — persistência do SDN-R;
  - três simuladores NTS-NG — um O-DU e dois O-RU de fronthaul;
  - A1 Policy Management Service e simulador de Near-RT RIC, no perfil
    opcional `a1`.
- **Portal de operação** (`portal/`) com oito telas: visão geral, inventário e
  topologia, provisionamento O1, falhas, desempenho, políticas A1, ciclo de vida
  de NF e ajuda. Backend em Node.js com duas dependências; frontend em módulos
  ES sem etapa de compilação e sem CDN, com gráficos em SVG próprios.
- **Provisionamento de dia 1 executado pelo SMO** (`portal/server/provisioning.js`):
  um reconciliador detecta cada elemento que conecta e aplica um perfil pela
  interface O1 — telemetria VES, notificações NETCONF, geração de falhas e, no
  O-DU, a assinatura de streaming e o job de medição de desempenho. Sem esse
  perfil os simuladores conectam mas não reportam nada.
- **Scripts de operação** (`deploy/scripts/`): `up`, `down`, `status` e `demo`.
  O `demo.sh` exercita os sete mecanismos do objeto de estudo em treze passos.
- **Relatório e apresentação** da Parte 2 em `.docx`/`.pptx` e `.pdf`, com as
  capturas da execução real.

### Divergências necessárias em relação à distribuição oficial

Quatro ajustes foram condição para a pilha funcionar; cada um está comentado no
ponto correspondente do `docker-compose.yaml`:

- **Healthcheck do controlador.** O compose oficial testa `/ready`, endpoint da
  camada SDNC do ONAP, ausente na imagem em modo `SDNRONLY`. Substituído pelo
  RESTCONF da topologia NETCONF.
- **NETCONF Call Home desativado nos simuladores.** Com Call Home e registro por
  VES ativos ao mesmo tempo, o mesmo dispositivo é montado duas vezes e o
  OpenDaylight falha com `Mount point already exists`. A implantação usa apenas
  o registro por VES, que é o fluxo canônico da OSC.
- **`datastore-populate` desativado nos O-RU.** No NTS-NG 1.8.1 a geração
  aleatória de dados sofre falha de segmentação ao validar `o-ran-usermgmt`,
  derrubando o daemon responsável pelo registro VES.
- **Healthchecks sem `curl`.** As imagens do A1 PMS e do ZooKeeper não trazem
  `curl` nem `wget`; as verificações usam `/dev/tcp` do bash.

### Simplificações deliberadas

Removidos da distribuição oficial por não pertencerem ao objeto de estudo:
Traefik com TLS, Keycloak e PostgreSQL, servidor DHCP em macvlan, Node-RED,
Jenkins, Wireshark, Grafana com InfluxDB, e o clone dos esquemas 3GPP MnS no
build do VES Collector. O Kafka roda com listener PLAINTEXT, sem SASL nem
autorizador OPA.
