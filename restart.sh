#!/usr/bin/env bash
# Полный перезапуск syncplay-stack в dev-режиме.
# Убивает старые процессы, пересобирает Spring, стартует всё.
# Логи: logs/spring.log, logs/next.log

set -e
cd "$(dirname "$0")"

JAVA_HOME_21="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
SPRING_DIR="./syncplay-spring"
SYNC_DIR="./syncplay-sync"
NEXT_DIR="./syncplay-next"
LOG_DIR="./logs"
SPRING_PID_FILE="$LOG_DIR/spring.pid"
SYNC_PID_FILE="$LOG_DIR/sync.pid"
NEXT_PID_FILE="$LOG_DIR/next.pid"

mkdir -p "$LOG_DIR"

# LAN IP машины. Меняется при смене сети (DHCP/раздача с телефона), поэтому
# вычисляем на каждом запуске и не хардкодим — иначе WS клиента бьётся в старый
# адрес и падает с "[ws] error event".
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

# Прописывает текущий LAN IP в NEXT_PUBLIC_SYNC_WS_URL фронтенда. Переменная
# NEXT_PUBLIC_* инлайнится Next.js при старте dev-сервера, поэтому пишем ДО него.
write_ws_env() {
  local env_file="$NEXT_DIR/.env.local"
  touch "$env_file"
  grep -v '^NEXT_PUBLIC_SYNC_WS_URL=' "$env_file" > "$env_file.tmp" 2>/dev/null || true
  mv "$env_file.tmp" "$env_file"
  echo "NEXT_PUBLIC_SYNC_WS_URL=ws://${LAN_IP}" >> "$env_file"
}

# ── Цвета ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}▶ $*${RESET}"; }
ok()    { echo -e "${GREEN}✓ $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
fail()  { echo -e "${RED}✗ $*${RESET}"; exit 1; }

# ── 1. Остановить старые процессы ──────────────────────────────────────────
step "Останавливаем старые процессы"

kill_pid_file() {
  local file="$1" label="$2"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && ok "Остановлен $label (PID $pid)" || true
    fi
    rm -f "$file"
  fi
}

kill_pid_file "$SPRING_PID_FILE" "Spring"
kill_pid_file "$SYNC_PID_FILE"   "Sync"
kill_pid_file "$NEXT_PID_FILE"   "Next.js"

# Подстраховка: убить по имени если pid-файл отсутствует
pkill -f "spring-boot:run"       2>/dev/null && warn "Добит spring-boot:run через pkill" || true
pkill -f "ts-node-dev.*index.ts" 2>/dev/null && warn "Добит syncplay-sync через pkill"   || true
pkill -f "next-server"           2>/dev/null && warn "Добит next-server через pkill"      || true
pkill -f "next dev"              2>/dev/null && warn "Добит next dev через pkill"          || true
sleep 1

# ── 2. Инфраструктура (postgres + minio) ────────────────────────────────────
step "Запускаем инфраструктуру (postgres + minio)"
docker compose up -d postgres minio

# Ждём healthcheck postgres
echo -n "  Ожидаем postgres"
for i in $(seq 1 20); do
  if docker compose exec -T postgres pg_isready -U musicapp -d music_streaming &>/dev/null; then
    echo; ok "PostgreSQL готов"; break
  fi
  echo -n "."; sleep 1
  [ "$i" -eq 20 ] && { echo; fail "PostgreSQL не поднялся за 20с"; }
done

ok "MinIO запущен"

# ── 3. Проверка Java 21 ─────────────────────────────────────────────────────
step "Проверяем Java 21"
if [ ! -x "$JAVA_HOME_21/bin/java" ]; then
  fail "Java 21 не найдена по пути $JAVA_HOME_21\nУстанови: brew install openjdk@21"
fi
ok "$("$JAVA_HOME_21/bin/java" -version 2>&1 | head -1)"

# ── 4. Сборка Spring ────────────────────────────────────────────────────────
step "Собираем Spring Boot"
(cd "$SPRING_DIR" && JAVA_HOME="$JAVA_HOME_21" mvn -q -DskipTests package) \
  || fail "Сборка Spring провалилась. Смотри вывод выше."
ok "Spring собран"

# ── 5. Зависимости Next.js и Sync ───────────────────────────────────────────
step "Проверяем зависимости Next.js и Sync"
if [ ! -d "$NEXT_DIR/node_modules" ]; then
  echo "  syncplay-next: node_modules не найдены, запускаем npm ci..."
  (cd "$NEXT_DIR" && npm ci)
fi
if [ ! -d "$SYNC_DIR/node_modules" ]; then
  echo "  syncplay-sync: node_modules не найдены, запускаем npm ci..."
  (cd "$SYNC_DIR" && npm ci)
fi
ok "Зависимости в порядке"

# ── 6. Запуск Spring ────────────────────────────────────────────────────────
step "Запускаем Spring Boot"
(
  cd "$SPRING_DIR"
  export JAVA_HOME="$JAVA_HOME_21"
  mvn -q spring-boot:run > "../$LOG_DIR/spring.log" 2>&1 &
  echo $! > "../$SPRING_PID_FILE"
)
ok "Spring запущен (PID $(cat $SPRING_PID_FILE)), лог: $LOG_DIR/spring.log"

# Ждём health
echo -n "  Ожидаем Spring"
for i in $(seq 1 40); do
  if curl -sf http://localhost:8080/actuator/health 2>/dev/null | grep -q '"UP"'; then
    echo; ok "Spring готов — http://localhost:8080"; break
  fi
  echo -n "."; sleep 2
  [ "$i" -eq 40 ] && { echo; fail "Spring не поднялся за 80с. Смотри $LOG_DIR/spring.log"; }
done

# ── 7. Запуск Sync ──────────────────────────────────────────────────────────
step "Запускаем syncplay-sync"
(
  cd "$SYNC_DIR"
  SPRING_URL=http://localhost:8080 \
  INTERNAL_SECRET=syncplay-internal-secret \
  PORT=3002 \
  npx ts-node-dev --respawn --transpile-only src/index.ts > "../$LOG_DIR/sync.log" 2>&1 &
  echo $! > "../$SYNC_PID_FILE"
)
ok "Sync запущен (PID $(cat $SYNC_PID_FILE)), лог: $LOG_DIR/sync.log"

# Ждём health sync
echo -n "  Ожидаем Sync"
for i in $(seq 1 15); do
  if curl -sf http://localhost:3002/health 2>/dev/null | grep -q "ok"; then
    echo; ok "Sync готов — ws://localhost:3002"; break
  fi
  echo -n "."; sleep 1
  [ "$i" -eq 15 ] && { echo; warn "Sync не ответил за 15с. Смотри $LOG_DIR/sync.log (продолжаем)"; }
done

# ── 8. Запуск Next.js ───────────────────────────────────────────────────────
step "Запускаем Next.js"
write_ws_env
ok "WS URL для фронтенда: ws://${LAN_IP} (записан в $NEXT_DIR/.env.local)"
(
  cd "$NEXT_DIR"
  export API_URL="http://localhost:8080"
  npm run dev -- -H 0.0.0.0 > "../$LOG_DIR/next.log" 2>&1 &
  echo $! > "../$NEXT_PID_FILE"
)
ok "Next.js запущен (PID $(cat $NEXT_PID_FILE)), лог: $LOG_DIR/next.log"

# Ждём 200 от Next
echo -n "  Ожидаем Next.js"
for i in $(seq 1 20); do
  if curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null | grep -q "200"; then
    echo; ok "Next.js готов — http://localhost:3000"; break
  fi
  echo -n "."; sleep 2
  [ "$i" -eq 20 ] && { echo; fail "Next.js не поднялся за 40с. Смотри $LOG_DIR/next.log"; }
done

# ── Итог ────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Стек запущен${RESET}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Приложение:     ${CYAN}http://localhost:3000${RESET}"
echo -e "  Локальная сеть: ${CYAN}http://${LAN_IP}:3000${RESET}"
echo -e "  API:            http://localhost:8080"
echo -e "  Sync WS:        ws://localhost:3002"
echo -e "  Логи Spring:    $LOG_DIR/spring.log"
echo -e "  Логи Sync:      $LOG_DIR/sync.log"
echo -e "  Логи Next:      $LOG_DIR/next.log"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo -e "  Остановить: ${YELLOW}kill \$(cat $SPRING_PID_FILE) \$(cat $SYNC_PID_FILE) \$(cat $NEXT_PID_FILE)${RESET}"
echo
