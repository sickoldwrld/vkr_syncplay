#!/usr/bin/env bash
# Полная компиляция всех компонентов проекта.
# Использование:
#   ./build.sh           — собрать всё (spring + sync + next)
#   ./build.sh spring    — только Spring Boot (mvn package)
#   ./build.sh sync      — только syncplay-sync (npm ci + tsc)
#   ./build.sh next      — только Next.js (npm ci + npm run build)
#   ./build.sh clean     — почистить артефакты и пересобрать всё
#   ./build.sh deps      — только установить/обновить npm зависимости

set -e
cd "$(dirname "$0")"

JAVA_HOME_21="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
SPRING_DIR="./syncplay-spring"
SYNC_DIR="./syncplay-sync"
NEXT_DIR="./syncplay-next"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

step() { echo -e "\n${CYAN}${BOLD}▶ $*${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; exit 1; }
time_it() {
  local start=$SECONDS
  "$@"
  local elapsed=$((SECONDS - start))
  echo -e "  ${CYAN}(${elapsed}s)${RESET}"
}

build_spring() {
  step "Spring Boot — mvn package"
  [ -x "$JAVA_HOME_21/bin/java" ] || fail "Java 21 не найдена: $JAVA_HOME_21 (brew install openjdk@21)"
  (cd "$SPRING_DIR" && JAVA_HOME="$JAVA_HOME_21" mvn -q -DskipTests package) \
    || fail "Spring build failed"
  local jar
  jar=$(ls "$SPRING_DIR/target/"*.jar 2>/dev/null | grep -v ".original$" | head -1)
  ok "Spring jar: $jar"
}

build_sync() {
  step "syncplay-sync — npm ci + type-check"
  if [ ! -d "$SYNC_DIR/node_modules" ] || [ "$SYNC_DIR/package.json" -nt "$SYNC_DIR/node_modules" ]; then
    (cd "$SYNC_DIR" && npm ci) || fail "sync npm ci failed"
  fi
  # Проверка типов TS — запуск идёт через ts-node-dev, отдельной компиляции не требуется
  (cd "$SYNC_DIR" && npx tsc --noEmit) || fail "sync TypeScript errors"
  ok "sync OK"
}

build_next() {
  step "syncplay-next — npm ci + build"
  if [ ! -d "$NEXT_DIR/node_modules" ] || [ "$NEXT_DIR/package.json" -nt "$NEXT_DIR/node_modules" ]; then
    (cd "$NEXT_DIR" && npm ci) || fail "next npm ci failed"
  fi
  # NEXT_PUBLIC_SYNC_WS_URL инлайнится в бандл на этапе build — прописываем
  # актуальный LAN IP машины ДО сборки, иначе клиент будет стучаться по старому
  # адресу и падать с "[ws] error event".
  local lan_ip env_file
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
  env_file="$NEXT_DIR/.env.local"
  touch "$env_file"
  grep -v '^NEXT_PUBLIC_SYNC_WS_URL=' "$env_file" > "$env_file.tmp" 2>/dev/null || true
  mv "$env_file.tmp" "$env_file"
  echo "NEXT_PUBLIC_SYNC_WS_URL=ws://${lan_ip}" >> "$env_file"
  ok "WS URL: ws://${lan_ip} (записан в .env.local)"
  (cd "$NEXT_DIR" && NEXT_TELEMETRY_DISABLED=1 npm run build) || fail "next build failed"
  ok "Next.js собран → $NEXT_DIR/.next"
}

install_deps() {
  step "Установка зависимостей (npm ci)"
  if [ -d "$SYNC_DIR" ]; then
    echo "  syncplay-sync..."
    (cd "$SYNC_DIR" && npm ci)
  fi
  if [ -d "$NEXT_DIR" ]; then
    echo "  syncplay-next..."
    (cd "$NEXT_DIR" && npm ci)
  fi
  ok "Зависимости установлены"
}

clean_all() {
  step "Очистка артефактов"
  rm -rf "$SPRING_DIR/target" && ok "spring/target удалён"
  rm -rf "$NEXT_DIR/.next" && ok "next/.next удалён"
  # node_modules не трогаем — это долго переустанавливать
}

TOTAL_START=$SECONDS

case "${1:-all}" in
  spring) build_spring ;;
  sync)   build_sync ;;
  next)   build_next ;;
  deps)   install_deps ;;
  clean)  clean_all; build_spring; build_sync; build_next ;;
  all)    build_spring; build_sync; build_next ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac

TOTAL=$((SECONDS - TOTAL_START))
echo -e "\n${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Готово за ${TOTAL}s${RESET}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
