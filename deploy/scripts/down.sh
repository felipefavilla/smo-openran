#!/usr/bin/env bash
# Encerra a pilha SMO.
#
#   ./down.sh           para e remove os conteineres
#   ./down.sh --purge   remove tambem os volumes (base do SDN-R e do Kafka)

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--purge" ]]; then
  echo "Removendo conteineres e volumes da pilha."
  docker compose --profile a1 down -v --remove-orphans
else
  echo "Parando e removendo os conteineres (volumes preservados)."
  docker compose --profile a1 down --remove-orphans
fi
