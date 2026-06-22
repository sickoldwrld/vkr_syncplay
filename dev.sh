#!/usr/bin/env bash
# Локальный запуск стека: Postgres+MinIO в docker, Spring/Sync/Next — нативно.
# Использование:
#   ./dev.sh up        — стартует postgres+minio в docker (если ещё не запущены)
#   ./dev.sh spring    — запускает Spring Boot (mvn spring-boot:run)
#   ./dev.sh sync      — запускает syncplay-sync (ts-node-dev)
#   ./dev.sh next      — запускает Next.js dev (npm run dev)
#   ./dev.sh build     — пересобирает spring (после правок Java)
#   ./dev.sh down      — гасит infra-контейнеры
#   ./dev.sh status    — показывает что где запущено
#   ./dev.sh ip        — печатает LAN IP (для доступа с других устройств)

set -e
cd "$(dirname "$0")"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

case "${1:-help}" in
  up)
    echo "→ postgres + minio через docker compose"
    docker compose up -d postgres minio
    echo
    echo "✓ Infra поднята. Дальше в двух терминалах:"
    echo "    ./dev.sh spring"
    echo "    ./dev.sh next"
    echo
    echo "  Доступ: http://localhost:3000"
    echo "  С других устройств: http://${LAN_IP}:3000"
    ;;
  spring)
    cd syncplay-spring
    # DB_URL/MINIO_ENDPOINT по умолчанию указывают на localhost — то что нужно.
    # CORS для LAN уже разрешён в application.yml.
    exec mvn -q spring-boot:run
    ;;
  sync)
    cd syncplay-sync
    [ -d node_modules ] || npm ci
    exec SPRING_URL=http://localhost:8080 \
         INTERNAL_SECRET=syncplay-internal-secret \
         PORT=3002 \
         npx ts-node-dev --respawn --transpile-only src/index.ts
    ;;
  build)
    cd syncplay-spring
    mvn -q -DskipTests package
    echo "✓ jar пересобран. Перезапусти Spring (Ctrl+C и ./dev.sh spring)."
    ;;
  next)
    # NEXT_PUBLIC_SYNC_WS_URL инлайнится при старте dev-сервера — пишем актуальный
    # LAN IP ДО запуска, иначе клиент стучится по старому адресу ([ws] error event).
    # Порт указываем явно (:3002), иначе при отсутствии nginx-прокси на :80
    # браузер пытается стучаться в дефолтный 80 и валится с "ws error event".
    SYNC_PORT="${SYNC_PORT:-3002}"
    touch syncplay-next/.env.local
    grep -v '^NEXT_PUBLIC_SYNC_WS_URL=' syncplay-next/.env.local > syncplay-next/.env.local.tmp 2>/dev/null || true
    mv syncplay-next/.env.local.tmp syncplay-next/.env.local
    echo "NEXT_PUBLIC_SYNC_WS_URL=ws://${LAN_IP}:${SYNC_PORT}" >> syncplay-next/.env.local
    echo "→ WS URL: ws://${LAN_IP}:${SYNC_PORT} (записан в syncplay-next/.env.local)"
    cd syncplay-next
    # API_URL читается next.config.js на этапе резолва rewrites.
    # При dev-режиме (npm run dev) он перечитывается на каждый рестарт.
    export API_URL="${API_URL:-http://localhost:8080}"
    [ -d node_modules ] || npm ci
    exec npm run dev -- -H 0.0.0.0
    ;;
  down)
    docker compose stop postgres minio
    pkill -f "ts-node-dev.*index.ts" 2>/dev/null || true
    ;;
  status)
    echo "─── Docker ───"
    docker compose ps postgres minio 2>/dev/null || true
    echo
    echo "─── Порты на хосте ───"
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':(3000|3002|8080|5432|9000|9001) ' || echo "  ничего на 3000/3002/8080/5432/9000/9001"
    echo
    echo "LAN IP: ${LAN_IP}"
    ;;
  ip)
    echo "${LAN_IP}"
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
