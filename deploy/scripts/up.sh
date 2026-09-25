#!/usr/bin/env bash
# Sobe a pilha SMO e aguarda cada camada ficar saudavel.
#
#   ./up.sh            nucleo O1 + pilha Open RAN simulada + portal
#   ./up.sh --with-a1  adiciona o Non-RT RIC (perfil "a1")

set -euo pipefail
cd "$(dirname "$0")/.."

PROFILES=()
[[ "${1:-}" == "--with-a1" ]] && PROFILES=(--profile a1)

blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }

# Aguarda um servico atingir o estado "healthy" (ou "running", para os que nao
# declaram healthcheck).
wait_healthy() {
  local service="$1" timeout="${2:-300}" waited=0
  printf '  aguardando %-16s' "$service"
  while (( waited < timeout )); do
    local cid state health
    cid=$(docker compose "${PROFILES[@]}" ps -q "$service" 2>/dev/null || true)
    if [[ -n "$cid" ]]; then
      state=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)
      if [[ "$health" == "healthy" ]] || { [[ "$health" == "none" ]] && [[ "$state" == "running" ]]; }; then
        green " ok (${waited}s)"
        return 0
      fi
      if [[ "$state" == "exited" ]]; then
        red " saiu com erro"
        docker compose "${PROFILES[@]}" logs --tail 40 "$service" || true
        return 1
      fi
    fi
    sleep 5; waited=$((waited + 5))
    printf '.'
  done
  red " tempo esgotado (${timeout}s)"
  docker compose "${PROFILES[@]}" logs --tail 40 "$service" || true
  return 1
}

blue "==> Construindo as imagens locais (VES Collector e portal)"
docker compose "${PROFILES[@]}" build

blue "==> Subindo a pilha"
docker compose "${PROFILES[@]}" up -d

blue "==> Infraestrutura"
wait_healthy persistence 180
wait_healthy zookeeper 120
wait_healthy kafka 240

blue "==> SMO / OAM"
wait_healthy ves-collector 180
echo "  o SDN-R (OpenDaylight) carrega dezenas de modulos na primeira subida;"
echo "  de 3 a 5 minutos e o normal."
wait_healthy controller 600

if [[ ${#PROFILES[@]} -gt 0 ]]; then
  blue "==> Non-RT RIC"
  wait_healthy near-rt-ric 180
  wait_healthy a1-pms 300
fi

blue "==> Portal"
wait_healthy smo-portal 120

PORTAL_PORT=$(grep -E '^PORTAL_PORT=' .env | cut -d= -f2)
ODLUX_PORT=$(grep -E '^ODLUX_PORT=' .env | cut -d= -f2)

echo
green "Pilha SMO em operacao."
echo
echo "  Portal SMO ......... http://localhost:${PORTAL_PORT}"
echo "  ODLUX (oficial) .... http://localhost:${ODLUX_PORT}   (admin / admin)"
echo
echo "As funcoes de rede levam de 1 a 2 minutos para concluir o registro de PNF"
echo "e o NETCONF Call Home. Acompanhe pela tela de Inventario do portal."
