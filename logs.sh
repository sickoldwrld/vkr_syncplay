#!/usr/bin/env bash
# Просмотр логов компонентов стека.
# Использование:
#   ./logs.sh             — tail -f всех трёх логов одновременно (через multitail или паралл.)
#   ./logs.sh spring      — только spring.log
#   ./logs.sh sync        — только sync.log
#   ./logs.sh next        — только next.log
#   ./logs.sh docker      — docker logs postgres+minio
#   ./logs.sh skip        — grep по строкам скипа в spring.log
#   ./logs.sh errors      — grep ERROR/WARN во всех логах

set -e
cd "$(dirname "$0")"

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"

YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; RESET='\033[0m'

tail_one() {
  local file="$1" label="$2"
  if [ -f "$file" ]; then
    tail -f "$file" | sed "s/^/[${label}] /"
  else
    echo -e "${YELLOW}⚠ $file не найден — компонент не запущен?${RESET}" >&2
  fi
}

case "${1:-all}" in
  spring) tail_one "$LOG_DIR/spring.log" "spring" ;;
  sync)   tail_one "$LOG_DIR/sync.log"   "sync" ;;
  next)   tail_one "$LOG_DIR/next.log"   "next" ;;

  all)
    echo -e "${CYAN}Tail всех трёх логов. Ctrl+C — выход.${RESET}"
    # Параллельный tail, цветные префиксы
    (tail -f "$LOG_DIR/spring.log" 2>/dev/null | sed -u "s/^/$(printf '\033[0;32m[spring]\033[0m ')/") &
    P1=$!
    (tail -f "$LOG_DIR/sync.log"   2>/dev/null | sed -u "s/^/$(printf '\033[0;36m[sync  ]\033[0m ')/") &
    P2=$!
    (tail -f "$LOG_DIR/next.log"   2>/dev/null | sed -u "s/^/$(printf '\033[1;35m[next  ]\033[0m ')/") &
    P3=$!
    trap "kill $P1 $P2 $P3 2>/dev/null; exit 0" INT TERM
    wait
    ;;

  docker)
    docker compose logs -f --tail=50 postgres minio
    ;;

  skip)
    echo -e "${CYAN}Строки про скипы из spring.log:${RESET}"
    grep -E "doPlay|skipToNext|→ scheduled|→ skip NOT" "$LOG_DIR/spring.log" 2>/dev/null | tail -50 \
      || echo "  (пусто)"
    ;;

  errors)
    echo -e "${RED}Ошибки и предупреждения:${RESET}"
    for f in "$LOG_DIR"/*.log; do
      [ -f "$f" ] || continue
      echo -e "\n${CYAN}── $(basename "$f") ──${RESET}"
      grep -E "ERROR|WARN|Exception|Failed" "$f" | tail -20 || echo "  (чисто)"
    done
    ;;

  *)
    sed -n '2,11p' "$0"
    exit 1
    ;;
esac
