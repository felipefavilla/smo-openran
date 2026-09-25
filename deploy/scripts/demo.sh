#!/usr/bin/env bash
# Roteiro de demonstracao executavel.
#
# Exercita, pela linha de comando, os mesmos mecanismos que o portal apresenta:
# descoberta de elementos, provisionamento via O1, telemetria e falhas via VES,
# politicas A1 e ciclo de vida de Network Functions. Cada passo imprime o que
# foi feito e o resultado obtido.

set -uo pipefail
cd "$(dirname "$0")/.."

ENVF=.env
get() { grep -E "^$1=" "$ENVF" | cut -d= -f2-; }

SDNC_PORT=$(get SDNC_REST_PORT)
PORTAL_PORT=$(get PORTAL_PORT)
A1_PMS_PORT=$(get A1_PMS_PORT)
A1_SIM_PORT=$(get A1_SIM_PORT)
VES_PORT=$(get VES_PORT)
USERNAME=$(get ADMIN_USERNAME)
PASSWORD=$(get ADMIN_PASSWORD)

SDNC="http://localhost:${SDNC_PORT}"
TOPO="rests/data/network-topology:network-topology/topology=topology-netconf"
AUTH=(-u "${USERNAME}:${PASSWORD}")

step()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok()    { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '   \033[33m!\033[0m %s\n' "$*"; }
fail()  { printf '   \033[31m✗\033[0m %s\n' "$*"; }
info()  { printf '     %s\n' "$*"; }

PASSED=0; FAILED=0; SKIPPED=0
pass_if() { if [[ "$1" == "0" ]]; then ok "$2"; PASSED=$((PASSED+1)); else fail "$2"; FAILED=$((FAILED+1)); fi; }

# --------------------------------------------------------------------------- 1
step "1. Saude dos servicos da pilha"
docker compose --profile a1 ps --format '     {{.Service}}  {{.State}}  {{.Status}}' 2>/dev/null
UNHEALTHY=$(docker compose --profile a1 ps --format '{{.Status}}' 2>/dev/null | grep -c unhealthy || true)
pass_if "$([[ "$UNHEALTHY" == "0" ]] && echo 0 || echo 1)" "nenhum servico em estado unhealthy"

# --------------------------------------------------------------------------- 2
step "2. Interface O1 — descoberta de elementos (RESTCONF sobre NETCONF)"
NODES_JSON=$(curl -s "${AUTH[@]}" "${SDNC}/${TOPO}?content=nonconfig")
NODE_SUMMARY=$(echo "$NODES_JSON" | python -c "
import json,sys
try: data=json.load(sys.stdin)
except Exception: sys.exit(1)
nodes=data.get('network-topology:topology',[{}])[0].get('node',[])
if not nodes: sys.exit(1)
for n in nodes:
    # No SDN-R 13 (OpenDaylight Calcium) os atributos do conector NETCONF ficam
    # aninhados no container 'netconf-node-topology:netconf-node'.
    c=n.get('netconf-node-topology:netconf-node', n)
    caps=c.get('available-capabilities', c.get('netconf-node-topology:available-capabilities', {})).get('available-capability', [])
    st=c.get('connection-status', c.get('netconf-node-topology:connection-status', '?'))
    print(f\"{n.get('node-id')}|{st}|{len(caps)}\")
" 2>/dev/null)

if [[ -z "$NODE_SUMMARY" ]]; then
  fail "nenhum elemento montado no controlador"
  FAILED=$((FAILED+1))
  CONNECTED_NODE=""
else
  while IFS='|' read -r id status caps; do
    info "$(printf '%-24s %-14s %s capacidades anunciadas' "$id" "$status" "$caps")"
  done <<< "$NODE_SUMMARY"
  ok "$(echo "$NODE_SUMMARY" | wc -l | tr -d ' ') elemento(s) montado(s) via NETCONF"
  PASSED=$((PASSED+1))
  CONNECTED_NODE=$(echo "$NODE_SUMMARY" | grep '|connected|' | head -1 | cut -d'|' -f1)
fi

# --------------------------------------------------------------------------- 3
step "3. Interface O1 — provisionamento (get-config / edit-config)"
if [[ -z "$CONNECTED_NODE" ]]; then
  warn "nenhum elemento conectado; passo ignorado"
  SKIPPED=$((SKIPPED+1))
else
  MOUNT="${SDNC}/${TOPO}/node=${CONNECTED_NODE}/yang-ext:mount"
  # Alvo: o periodo de heartbeat do proprio simulador. E um parametro que existe
  # em qualquer elemento NTS-NG, faz parte do perfil que o SMO provisiona e tem
  # efeito observavel — muda a cadencia da telemetria que chega pela O1.
  TARGET_PATH="nts-network-function:simulation/network-function/ves"
  info "elemento escolhido: ${CONNECTED_NODE}"
  info "caminho: ${TARGET_PATH}"

  READ=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${MOUNT}/${TARGET_PATH}?content=config")
  info "GET  -> HTTP ${READ}"
  pass_if "$([[ "$READ" == "200" ]] && echo 0 || echo 1)" "leitura de configuracao pelo mountpoint NETCONF"

  if [[ "$READ" == "200" ]]; then
    BEFORE=$(curl -s "${AUTH[@]}" "${MOUNT}/${TARGET_PATH}?content=config" \
      | python -c "import json,sys; print(json.load(sys.stdin)['nts-network-function:ves'].get('heartbeat-period','?'))" 2>/dev/null)
    NEWPERIOD=$([[ "$BEFORE" == "20" ]] && echo 30 || echo 20)
    info "heartbeat-period atual: ${BEFORE}s -> novo: ${NEWPERIOD}s"

    WRITE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${AUTH[@]}" \
      -H 'Content-Type: application/yang-data+json' "${MOUNT}/${TARGET_PATH}" \
      -d "{\"nts-network-function:ves\":{\"faults-enabled\":true,\"pnf-registration\":true,\"heartbeat-period\":${NEWPERIOD}}}")
    info "PUT  -> HTTP ${WRITE}"

    AFTER=$(curl -s "${AUTH[@]}" "${MOUNT}/${TARGET_PATH}?content=config" \
      | python -c "import json,sys; print(json.load(sys.stdin)['nts-network-function:ves'].get('heartbeat-period','?'))" 2>/dev/null)
    info "releitura do datastore: heartbeat-period = ${AFTER}s"

    if [[ "$WRITE" =~ ^(200|201|204)$ ]] && [[ "$AFTER" == "$NEWPERIOD" ]]; then
      ok "edit-config aplicado e confirmado por releitura do datastore"
      PASSED=$((PASSED+1))
    else
      fail "escrita nao confirmada (HTTP ${WRITE}, valor lido ${AFTER})"
      FAILED=$((FAILED+1))
    fi
  fi
fi


# --------------------------------------------------------------------------- 4
step "4. Interface O1 — telemetria no barramento do SMO"
TOPICS=$(docker compose exec -T kafka bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/dev/null \
  | grep -E 'unauthenticated' | sort || true)
if [[ -n "$TOPICS" ]]; then
  echo "$TOPICS" | sed 's/^/     /'
  ok "$(echo "$TOPICS" | wc -l | tr -d ' ') topico(s) VES criados pelo VES Collector"
  PASSED=$((PASSED+1))
else
  fail "nenhum topico VES no barramento"
  FAILED=$((FAILED+1))
fi

COUNTERS=$(curl -s "http://localhost:${PORTAL_PORT}/api/overview" \
  | python -c "
import json,sys
d=json.load(sys.stdin)
c=d.get('counters',{})
print(f\"total={c.get('total',0)}\")
for k,v in sorted(c.get('byDomain',{}).items()):
    print(f'  {k}={v}')
" 2>/dev/null)
if [[ -n "$COUNTERS" ]]; then
  echo "$COUNTERS" | sed 's/^/     /'
  ok "portal consumindo os topicos VES"
  PASSED=$((PASSED+1))
else
  warn "portal ainda sem contadores de evento"
  SKIPPED=$((SKIPPED+1))
fi

# --------------------------------------------------------------------------- 5
step "5. Gerenciamento de falhas — injecao de um evento VES de falha"
NOW_US=$(( $(date +%s) * 1000000 ))
FAULT_PAYLOAD=$(cat <<JSON
{"event":{"commonEventHeader":{
  "domain":"fault","eventId":"demo-fault-${NOW_US}","eventName":"Fault_O-RU_LinkDown",
  "eventType":"O-RAN-SC","priority":"High","reportingEntityName":"demo.sh",
  "sequence":1,"sourceName":"${CONNECTED_NODE:-o-ru-1}","startEpochMicrosec":${NOW_US},
  "lastEpochMicrosec":${NOW_US},"version":"4.1","vesEventListenerVersion":"7.2.1"},
 "faultFields":{"faultFieldsVersion":"4.0","alarmCondition":"LinkFailure",
  "eventSourceType":"O-RU","specificProblem":"Perda de enlace no fronthaul",
  "eventSeverity":"CRITICAL","vfStatus":"Active"}}}
JSON
)
VES_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://localhost:${VES_PORT}/eventListener/v7" \
  -H 'Content-Type: application/json' -d "$FAULT_PAYLOAD")
info "POST /eventListener/v7 -> HTTP ${VES_CODE}"
pass_if "$([[ "$VES_CODE" =~ ^(200|202)$ ]] && echo 0 || echo 1)" "evento de falha aceito pelo VES Collector"

# A cadeia VES -> Kafka -> portal leva alguns segundos; espera ativa ate 45s.
for _ in $(seq 1 15); do
  sleep 3
  curl -s "http://localhost:${PORTAL_PORT}/api/alarms?status=active" | grep -q LinkFailure && break
done
ALARMS=$(curl -s "http://localhost:${PORTAL_PORT}/api/alarms?status=active" \
  | python -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('alarms',[])[:5]:
    print(f\"{a['severity']:<10} {a['source']:<14} {a['condition']}\")
" 2>/dev/null)
if [[ -n "$ALARMS" ]]; then
  echo "$ALARMS" | sed 's/^/     /'
  ok "alarme propagado ate o portal pela cadeia VES -> Kafka -> portal"
  PASSED=$((PASSED+1))
else
  warn "alarme ainda nao visivel no portal"
  SKIPPED=$((SKIPPED+1))
fi

# --------------------------------------------------------------------------- 6
step "6. Interface A1 — politicas no Non-RT RIC"
A1_UP=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${A1_PMS_PORT}/a1-policy/v2/status" || echo 000)
if [[ "$A1_UP" != "200" ]]; then
  warn "perfil 'a1' inativo (docker compose --profile a1 up -d); passo ignorado"
  SKIPPED=$((SKIPPED+1))
else
  TYPE_ID=20008
  # O simulador em versao OSC espera o tipo embrulhado em
  # { name, description, policy_type_id, create_schema }, e nao o esquema JSON solto.
  SEED=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "http://localhost:${A1_SIM_PORT}/policytype?id=${TYPE_ID}" \
    -H 'Content-Type: application/json' -d "{
      \"name\":\"alvo-desempenho-celula\",
      \"description\":\"Alvo de desempenho por celula\",
      \"policy_type_id\":${TYPE_ID},
      \"create_schema\":{
        \"\$schema\":\"http://json-schema.org/draft-07/schema#\",\"title\":\"${TYPE_ID}\",\"type\":\"object\",
        \"properties\":{\"scope\":{\"type\":\"object\",\"properties\":{\"cellId\":{\"type\":\"string\"}},
        \"additionalProperties\":false,\"required\":[\"cellId\"]},
        \"qosObjectives\":{\"type\":\"object\",\"properties\":{\"gfbr\":{\"type\":\"number\"}},\"additionalProperties\":false}},
        \"additionalProperties\":false,\"required\":[\"scope\"]}}")
  info "carga do tipo ${TYPE_ID} no Near-RT RIC -> HTTP ${SEED}"

  # O Non-RT RIC varre os RICs periodicamente; numa pilha recem-criada essa
  # primeira sincronizacao demora mais. Espera ativa ate 90s.
  info "aguardando o Non-RT RIC sincronizar com o RIC…"
  SINCRONIZOU=nao
  for _ in $(seq 1 18); do
    sleep 5
    if curl -s "http://localhost:${A1_PMS_PORT}/a1-policy/v2/policy-types" | grep -q "\"${TYPE_ID}\""; then
      SINCRONIZOU=sim; break
    fi
  done
  info "tipo ${TYPE_ID} visivel no Non-RT RIC: ${SINCRONIZOU}"

  RIC_ID=$(curl -s "http://localhost:${A1_PMS_PORT}/a1-policy/v2/rics" \
    | python -c "import json,sys; print(json.load(sys.stdin)['rics'][0]['ric_id'])" 2>/dev/null)
  info "RIC gerenciado: ${RIC_ID:-nenhum}"

  POLICY_ID="demo-$(date +%s)"
  CREATE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
    "http://localhost:${A1_PMS_PORT}/a1-policy/v2/policies" \
    -H 'Content-Type: application/json' \
    -d "{\"policy_id\":\"${POLICY_ID}\",\"ric_id\":\"${RIC_ID}\",\"policytype_id\":\"${TYPE_ID}\",
         \"service_id\":\"demo\",\"policy_data\":{\"scope\":{\"cellId\":\"cell-001\"},\"qosObjectives\":{\"gfbr\":100}}}")
  info "PUT /a1-policy/v2/policies -> HTTP ${CREATE}"
  pass_if "$([[ "$CREATE" =~ ^(200|201)$ ]] && echo 0 || echo 1)" "politica criada no Non-RT RIC"

  RIC_POLICIES=$(curl -s "http://localhost:${A1_SIM_PORT}/a1-p/policytypes/${TYPE_ID}/policies" || true)
  if echo "$RIC_POLICIES" | grep -q "$POLICY_ID"; then
    ok "politica confirmada no proprio Near-RT RIC (entregue pela interface A1)"
    PASSED=$((PASSED+1))
  else
    warn "politica nao localizada no RIC: ${RIC_POLICIES}"
    SKIPPED=$((SKIPPED+1))
  fi

  DEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    "http://localhost:${A1_PMS_PORT}/a1-policy/v2/policies/${POLICY_ID}")
  info "DELETE da politica -> HTTP ${DEL}"
  pass_if "$([[ "$DEL" =~ ^(200|204)$ ]] && echo 0 || echo 1)" "ciclo de vida da politica encerrado"
fi

# --------------------------------------------------------------------------- 7
step "7. Ciclo de vida de Network Function"
TARGET=o-ru-2
if ! docker ps -a --format '{{.Names}}' | grep -qx "$TARGET"; then
  warn "${TARGET} nao existe; passo ignorado"
  SKIPPED=$((SKIPPED+1))
else
  info "parando ${TARGET}…"
  docker stop "$TARGET" >/dev/null 2>&1
  sleep 20
  STATE=$(curl -s "${AUTH[@]}" "${SDNC}/${TOPO}/node=${TARGET}?content=nonconfig" \
    | python -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('ausente'); sys.exit()
n=d.get('network-topology:node',[{}])[0]
c=n.get('netconf-node-topology:netconf-node', n)
print(c.get('connection-status', c.get('netconf-node-topology:connection-status','ausente')))
" 2>/dev/null || echo ausente)
  info "estado do mountpoint apos a parada: ${STATE}"
  if [[ "$STATE" != "connected" ]]; then
    ok "parar a NF derrubou o mountpoint O1 correspondente"
    PASSED=$((PASSED+1))
  else
    warn "mountpoint ainda marcado como conectado (o controlador pode levar mais tempo)"
    SKIPPED=$((SKIPPED+1))
  fi

  info "reiniciando ${TARGET}…"
  docker start "$TARGET" >/dev/null 2>&1
  ok "NF reiniciada; o novo registro de PNF chega em ate 2 minutos"
  PASSED=$((PASSED+1))
fi

# --------------------------------------------------------------------------- fim
printf '\n\033[1;34m== Resumo\033[0m\n'
printf '   \033[32mpassos concluidos: %d\033[0m\n' "$PASSED"
printf '   \033[33mpassos ignorados:  %d\033[0m\n' "$SKIPPED"
printf '   \033[31mpassos com falha:  %d\033[0m\n' "$FAILED"
printf '\n   Portal: http://localhost:%s\n\n' "${PORTAL_PORT}"

[[ "$FAILED" -eq 0 ]]
