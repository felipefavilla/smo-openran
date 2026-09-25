#!/usr/bin/env bash
# Estado resumido da pilha: conteineres, mountpoints NETCONF e topicos VES.

set -uo pipefail
cd "$(dirname "$0")/.."

SDNC_PORT=$(grep -E '^SDNC_REST_PORT=' .env | cut -d= -f2)
PORTAL_PORT=$(grep -E '^PORTAL_PORT=' .env | cut -d= -f2)
USER=$(grep -E '^ADMIN_USERNAME=' .env | cut -d= -f2)
PASS=$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2)

echo "=============================================================="
echo " Conteineres"
echo "=============================================================="
docker compose --profile a1 ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

echo
echo "=============================================================="
echo " Mountpoints NETCONF no SDN-R (interface O1)"
echo "=============================================================="
curl -s -u "${USER}:${PASS}" \
  "http://localhost:${SDNC_PORT}/rests/data/network-topology:network-topology/topology=topology-netconf?content=nonconfig" \
  | python -c "
import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    print('  (controlador ainda nao responde)'); sys.exit(0)
nodes = data.get('network-topology:topology', [{}])[0].get('node', [])
if not nodes:
    print('  (nenhum elemento montado)')
for n in nodes:
    # No SDN-R 13 os atributos do conector ficam aninhados.
    c = n.get('netconf-node-topology:netconf-node', n)
    nid = n.get('node-id')
    st  = c.get('connection-status', c.get('netconf-node-topology:connection-status', '?'))
    caps = c.get('available-capabilities', c.get('netconf-node-topology:available-capabilities', {})).get('available-capability', [])
    print(f'  {nid:<24} {st:<14} {len(caps)} modulos YANG')
" 2>/dev/null || echo "  (controlador indisponivel)"

echo
echo "=============================================================="
echo " Topicos VES no barramento Kafka"
echo "=============================================================="
docker compose exec -T kafka bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/dev/null \
  | grep -E 'unauthenticated|SEC_|VES_' | sed 's/^/  /' || echo "  (Kafka indisponivel)"

echo
echo "=============================================================="
echo " Portal"
echo "=============================================================="
curl -s "http://localhost:${PORTAL_PORT}/api/health" | sed 's/^/  /' || echo "  (portal indisponivel)"
echo
