#!/usr/bin/env bash
# swarm-files — хранилище файлов к задачам на MUSPELHEIM (files/README.md). Управление с Мака.
#
#   scripts/swarm-files.sh up       — клон origin/main на сервере, сборка и запуск (только localhost)
#   scripts/swarm-files.sh publish  — открыть наружу: путь /swarm-files на Funnel-порту 10000
#                                      (соседние пути порта не трогаются). Решение владельца.
#   scripts/swarm-files.sh status   — контейнер, health снаружи, место на диске
#   scripts/swarm-files.sh logs | down
#   FILES_PUBLIC_KEY=<base64> scripts/swarm-files.sh key — записать открытый ключ в state\files.env
#
# Файлы на сервере: C:\projects\swarm-files\repo (клон), \state\files.env (ключ и origins,
# вне git), \data (сами файлы). `up` — раскатка кода сервиса: только по «да» владельца.
set -euo pipefail

HOST="${SWARM_FILES_SSH:-muspelheim}"
REPO_URL='https://github.com/GarroV/Swarm-brain.git'
BRANCH="${SWARM_FILES_BRANCH:-main}"
ROOT='C:\projects\swarm-files'
REPO="${ROOT}\\repo"
ENV_FILE="${ROOT}\\state\\files.env"
DATA="${ROOT}\\data"
FUNNEL_PORT=10000
FUNNEL_PATH=/swarm-files
PUBLIC_URL="https://muspelheim.tail48dfee.ts.net:${FUNNEL_PORT}${FUNNEL_PATH}"
ORIGINS="${FILES_ALLOWED_ORIGINS:-https://swarm-team.app,https://swarm-brain.pages.dev}"

remote() { ssh "$HOST" "$@"; }
say() { printf '[swarm-files %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }
compose() {
  remote "cd /d ${REPO}\\files && set FILES_ENV_FILE=${ENV_FILE}&& set FILES_DATA=${DATA}&& docker compose -p swarm-files $*"
}

case "${1:-}" in
  key)
    [[ "${FILES_PUBLIC_KEY:-}" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "FILES_PUBLIC_KEY — открытый ключ Ed25519 (base64, 44 символа) из прогона files-signing-key.yml"
    remote "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force ${ROOT}\\state,${DATA} | Out-Null; Set-Content -Encoding ascii -Path '${ENV_FILE}' -Value @('FILES_PUBLIC_KEY=${FILES_PUBLIC_KEY}','FILES_ALLOWED_ORIGINS=${ORIGINS}')\""
    say "ключ записан в ${ENV_FILE}; перезапуск — scripts/swarm-files.sh up"
    ;;
  up)
    remote "if not exist ${ENV_FILE} exit 3" || die "нет ${ENV_FILE} — сначала scripts/swarm-files.sh key"
    remote "if not exist ${REPO}\\.git git clone -q ${REPO_URL} ${REPO}"
    remote "git -C ${REPO} fetch -q origin ${BRANCH} && git -C ${REPO} checkout -q -B ${BRANCH} origin/${BRANCH} && git -C ${REPO} log --oneline -1"
    compose "up -d --build"
    sleep 3
    "$0" status
    ;;
  publish)
    # Путь добавляется к уже открытому порту 10000, соседние пути (например /qr) не трогаются.
    remote "tailscale funnel --bg --https=${FUNNEL_PORT} --set-path ${FUNNEL_PATH} http://127.0.0.1:8031" >/dev/null
    remote "tailscale funnel status"
    ;;
  status)
    compose "ps"
    printf 'снаружи: '; curl -s -m 10 -o /dev/null -w '%{http_code}\n' "${PUBLIC_URL}/health" || echo "не отвечает"
    remote "powershell -NoProfile -Command \"'{0:N1} GB free, files: {1}' -f ((Get-PSDrive C).Free/1GB), (Get-ChildItem ${DATA} -File -ErrorAction SilentlyContinue | Measure).Count\""
    ;;
  logs) compose "logs --tail 100" ;;
  down) compose "down" ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
