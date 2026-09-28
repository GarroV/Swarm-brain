#!/usr/bin/env bash
# Стенд живого прогона бота scriba (T004) на MUSPELHEIM — управление с Мака одной командой.
#
#   scripts/scriba-live.sh up          — обновить клон ветки на сервере и поднять стенд (с нуля тоже)
#   scripts/scriba-live.sh down        — опустить (данные базы и секреты сохраняются)
#   scripts/scriba-live.sh wipe        — опустить и стереть свои тома поимённо
#   scripts/scriba-live.sh status      — что живо, код какой ревизии, хвост оркестратора
#   scripts/scriba-live.sh login-url   — ссылка входа в веб стенда за владельца встречи
#   scripts/scriba-live.sh invite <ссылка Meet> — позвать бота от лица владельца (путь D017)
#   scripts/scriba-live.sh logs        — живой лог оркестратора и бота (Ctrl-C — выйти)
#   scripts/scriba-live.sh notices     — что бот и сервер «отправили в Telegram» владельцу
#   scripts/scriba-live.sh meetings    — встречи стенда: статус, источник, говорящие, в очереди ли
#
# Код на сервер попадает клоном ветки из origin, не с диска Мака: сначала запушь.
# Ветка — SCRIBA_LIVE_BRANCH (по умолчанию chores/live-stand).
# Прод не участвует: база — локальный контур на MUSPELHEIM, Telegram подменён, OpenAI подменён,
# пока в state/openai.key на сервере нет живого ключа (docs/furca/live-run-T004.md).
set -euo pipefail

HOST="${SCRIBA_LIVE_SSH:-muspelheim}"
ADDR="${SCRIBA_LIVE_ADDR:-100.64.116.67}"
BRANCH="${SCRIBA_LIVE_BRANCH:-chores/live-stand}"
REPO='C:\projects\scriba-live\repo'
PS="pwsh -NoProfile -File C:\\projects\\scriba-live\\repo\\scripts\\scriba-live\\stand.ps1"
WEB="http://${ADDR}:4425"
FN="http://${ADDR}:4424/functions/v1"

remote() { ssh "$HOST" "$@"; }

sync_code() {
  local local_head remote_head
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git ls-remote origin "refs/heads/${BRANCH}" | cut -f1)"
  if [ -z "$remote_head" ]; then
    echo "✘ ветки ${BRANCH} нет в origin — запушь её: git push -u origin ${BRANCH}" >&2
    exit 1
  fi
  if [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && [ "$local_head" != "$remote_head" ]; then
    echo "⚠ локальный HEAD ${local_head:0:8} не равен origin/${BRANCH} ${remote_head:0:8}: на стенд едет origin" >&2
  fi
  remote "git -C ${REPO} fetch -q origin ${BRANCH} && git -C ${REPO} checkout -q -B ${BRANCH} origin/${BRANCH} && git -C ${REPO} log --oneline -1"
}

secret() { remote "$PS secret $1" | tr -d '\r\n'; }

session_cookie() {
  local key jar
  key="$(secret STAND_LOGIN_KEY)"
  jar="$(mktemp)"
  curl -fsS -o /dev/null -c "$jar" "${WEB}/api/auth/local?key=${key}"
  echo "$jar"
}

case "${1:-status}" in
  up)
    sync_code
    remote "$PS up"
    echo "веб: ${WEB}   вход: scripts/scriba-live.sh login-url"
    ;;
  down) remote "$PS down" ;;
  wipe) remote "$PS wipe" ;;
  status)
    remote "$PS status"
    printf '\nс Мака: '
    curl -fsS -m 5 "${FN%/functions/v1}/health" && echo || echo "функции по ${ADDR}:4424 не отвечают"
    ;;
  login-url) echo "${WEB}/api/auth/local?key=$(secret STAND_LOGIN_KEY)" ;;
  invite)
    url="${2:?нужна ссылка: scripts/scriba-live.sh invite https://meet.google.com/xxx-yyyy-zzz}"
    jar="$(session_cookie)"
    trap 'rm -f "$jar"' EXIT
    # Тот же вызов, что делает карточка «Позвать бота» в вебе (POST /api/meeting-invites).
    body="$(printf '{"join_url":"%s"}' "$url")"
    curl -sS -b "$jar" -H 'Content-Type: application/json' -X POST -d "$body" \
      -w '\nHTTP %{http_code}\n' "${WEB}/api/meeting-invites"
    echo "бот заберёт приглашение за ~5 с; смотреть: scripts/scriba-live.sh logs"
    ;;
  logs) ssh -t "$HOST" "docker logs -f --tail 200 scriba-live-orchestrator-1" ;;
  notices) remote "type C:\\projects\\scriba-live\\state\\telegram.jsonl 2>nul || echo (уведомлений пока не было)" ;;
  meetings)
    jar="$(session_cookie)"
    trap 'rm -f "$jar"' EXIT
    remote "docker exec supabase_db_scriba-live psql -U postgres -At -F ' | ' -c \"select id, status, source, identity_kind, claim_owner, recorded_seconds, jsonb_array_length(coalesce(process_state->'speakers','[]'::jsonb)) as speakers, jsonb_array_length(coalesce(transcript->'segments','[]'::jsonb)) as segments, created_at from meetings order by created_at desc limit 10\""
    printf '\nочередь вычитки владельца (GET /api/meetings?confirmed=false):\n'
    curl -sS -b "$jar" "${WEB}/api/meetings?confirmed=false" | head -c 1500
    echo
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
