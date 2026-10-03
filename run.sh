#!/usr/bin/env bash
# Быстрый запуск BeesCAD одной командой:
#   • при запуске проверяет GitHub — если в ветке main появился новый коммит,
#     тянет его (git merge --ff-only), пересобирает и перезапускает сервер;
#   • собирает (при необходимости), поднимает локальный сервер на порту 8080
#     и открывает браузер.
# Пошаговая инструкция для новичков — INSTALL_UBUNTU.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${PORT:-8080}"
URL="http://127.0.0.1:$PORT"
LOG="node_modules/.cache/run-server.log"
PIDFILE="node_modules/.cache/run-server.pid"

err() { printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  err "не запускайте через sudo: файлы сборки станут недоступны вашему пользователю. Выполните просто:  bash run.sh"
fi
command -v node >/dev/null || err "Node.js не найден. Установите Node.js 18 или новее — шаг 3 в INSTALL_UBUNTU.md"
command -v npm  >/dev/null || err "npm не найден. Выполните:  sudo apt install -y npm"
[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 18 ] \
  || err "нужен Node.js 18 или новее, а установлен $(node -v). Обновите Node.js — шаг 3 в INSTALL_UBUNTU.md"

CODE_CHANGED=0

# ---------------- автообновление с GitHub ----------------
# Только для ветки main и чистого дерева: у разработчика (другая ветка или
# несохранённые правки) код не трогаем. Без сети — тихо пропускаем.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$CUR_BRANCH" = "main" ] && git diff --quiet && git diff --cached --quiet; then
    OLD_SHA=$(git rev-parse HEAD 2>/dev/null || true)
    if git fetch origin main --quiet 2>/dev/null; then
      NEW_SHA=$(git rev-parse origin/main 2>/dev/null || true)
      if [ -n "$NEW_SHA" ] && [ "$OLD_SHA" != "$NEW_SHA" ]; then
        echo "==> обнаружена новая версия в GitHub (${OLD_SHA:0:7} -> ${NEW_SHA:0:7})"
        if git merge --ff-only origin/main --quiet; then
          CODE_CHANGED=1
          echo "==> обновлено до $(git rev-parse --short HEAD)"
        else
          echo "==> не удалось применить обновление (merge), запускаем текущую версию"
        fi
      fi
    else
      echo "==> GitHub недоступен — запускаем текущую версию"
    fi
  fi
fi

# зависимости: при первом запуске и после обновления package-lock.json (например, git pull)
if [ "$CODE_CHANGED" = "1" ] || [ ! -f node_modules/.package-lock.json ] || { [ -f package-lock.json ] && [ package-lock.json -nt node_modules/.package-lock.json ]; }; then
  if [ -f package-lock.json ]; then
    echo "==> npm ci"
    npm ci --no-audit --no-fund --no-update-notifier --loglevel=error
  else
    echo "==> npm install"
    npm install --no-audit --no-fund --no-update-notifier --loglevel=error
  fi
fi
# сборка: при первом запуске и после изменения исходников
if [ "$CODE_CHANGED" = "1" ] || [ ! -f dist/index.html ] || [ -n "$(find src index.html package.json vite.config.ts tsconfig.json scripts -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> npm run build"
  npm run build --no-update-notifier
  CODE_CHANGED=1
fi

# отвечает ли на порту именно наш сервер
alive() {
  node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(1000) })
    .then((r) => r.text())
    .then((t) => process.exit(t.includes("\"ok\":true") ? 0 : 1), () => process.exit(1))' \
    "$URL/healthz" >/dev/null 2>&1
}
# остановить сервер; 0 — остановлен, 1 — не удалось
stop_server() {
  local pid="" p i=0
  [ -f "$PIDFILE" ] && pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$PORT/tcp" 2>/dev/null || true
  else
    for p in $(pgrep -f "server\.mjs $PORT( |$)" 2>/dev/null || true); do
      kill "$p" 2>/dev/null || true
    done
  fi
  rm -f "$PIDFILE"
  while [ "$i" -lt 40 ] && alive; do sleep 0.25; i=$((i + 1)); done
  ! alive
}

if alive; then
  if [ "$CODE_CHANGED" = "1" ]; then
    echo "==> перезапуск сервера с новой версией"
    stop_server || err "не удалось остановить старый сервер на порту $PORT.
Остановите его вручную (процесс «node … server.mjs $PORT») и повторите:  bash run.sh"
  else
    echo "Уже запущен: $URL"
  fi
fi
if ! alive; then
  mkdir -p "$(dirname "$LOG")"
  nohup node scripts/server.mjs "$PORT" >"$LOG" 2>&1 &
  PID=$!
  echo "$PID" > "$PIDFILE"
  for _ in $(seq 1 40); do
    alive && break
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.25
  done
  if ! alive; then
    cat "$LOG" >&2
    err "сервер не запустился (причина выше). Если порт $PORT занят другой программой, выберите другой:  PORT=8090 bash run.sh"
  fi
  echo "Сервер работает в фоне (остановить: kill $PID)"
fi
echo "Открываю $URL"
xdg-open "$URL" >/dev/null 2>&1 || echo "Откройте в браузере: $URL"
