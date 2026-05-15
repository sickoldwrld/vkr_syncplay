#!/usr/bin/env bash
# Чистая остановка всего стека: локальные процессы (по pid-файлам и pkill) + docker.
# Использование:
#   ./stop.sh         — остановить локальные процессы (Spring/Sync/Next) и docker (postgres/minio)
#   ./stop.sh local   — только локальные процессы (docker оставить)
#   ./stop.sh docker  — только docker (локальные процессы оставить)

set -e
cd "$(dirname "$0")"

LOG_DIR="./logs"
SPRING_PID_FILE="$LOG_DIR/spring.pid"
SYNC_PID_FILE="$LOG_DIR/sync.pid"
NEXT_PID_FILE="$LOG_DIR/next.pid"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

kill_pid_file() {
  local file="$1" label="$2"
  if [ -f "$file" ]; then
    local pid; pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo -e "  ${GREEN}✓${RESET} $label остановлен (PID $pid)" || true
    fi
    rm -f "$file"
  fi
}

stop_local() {
  echo -e "${CYAN}▶ Останавливаем локальные процессы${RESET}"
  kill_pid_file "$SPRING_PID_FILE" "Spring"
  kill_pid_file "$SYNC_PID_FILE"   "Sync"
  kill_pid_file "$NEXT_PID_FILE"   "Next.js"

  # Подстраховка по имени процессов
  local killed=0
  for pat in "spring-boot:run" "ts-node-dev.*index.ts" "next-server" "next dev"; do
    if pkill -f "$pat" 2>/dev/null; then
      echo -e "  ${YELLOW}⚠${RESET} Добит '$pat' через pkill"
      killed=1
    fi
  done
  [ $killed -eq 0 ] && echo -e "  ${GREEN}✓${RESET} Лишних процессов не найдено"

  # Освобождаем порты если что-то ещё висит
  for port in 8080 3000 3002; do
    pid=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
      # Не трогаем docker
      cmd=$(ps -p "$pid" -o command= 2>/dev/null | head -1)
      if [[ "$cmd" != *Docker* ]]; then
        kill "$pid" 2>/dev/null && echo -e "  ${YELLOW}⚠${RESET} Освобождён порт $port (PID $pid)"
      fi
    fi
  done
}

stop_docker() {
  echo -e "\n${CYAN}▶ Останавливаем docker-инфраструктуру${RESET}"
  docker compose stop postgres minio 2>/dev/null || true
  echo -e "  ${GREEN}✓${RESET} Docker контейнеры остановлены"
}

case "${1:-all}" in
  local)  stop_local ;;
  docker) stop_docker ;;
  all)    stop_local; stop_docker ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac

echo -e "\n${GREEN}Готово.${RESET}"
