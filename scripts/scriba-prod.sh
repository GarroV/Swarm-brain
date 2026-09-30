#!/usr/bin/env bash
# Боевой бот встреч scriba: раскатка и управление с Мака. Сервер — VPS Contabo (с 30.09.2026, D039;
# до этого — MUSPELHEIM), прод — Swarm.
#
#   scripts/scriba-prod.sh rollout   — вся раскатка по порядку (ниже), нужен SCRIBA_WORKSPACE
#   scripts/scriba-prod.sh up        — обновить клон на VPS до origin/main и поднять бота
#   scripts/scriba-prod.sh status | logs | down
#
# rollout — только в ночное окно 23:00–06:59 по Белграду (FORCE=1 — осознанный обход) и только
# по «да» владельца в разговоре. Шаги:
#   1. PR-ы из SCRIBA_PRS (через пробел) вливаются в main, если ещё открыты;
#   2. функции — deploy-functions.yml с main. Проверку «кто в проде» CI сделать не может: её
#      делает человек заранее и подтверждает ACTIVITY_CHECKED=1 (никто не пишет, ничего не
#      обрабатывается). Без подтверждения rollout останавливается до раскатки функций;
#   3. клон main на VPS, токен бота рождается там же — сюда приходит только хеш;
#   4. хеш уходит в прод кнопкой scriba-agent-token.yml (воркспейс — SCRIBA_WORKSPACE);
#   5. оркестратор поднимается и показывает журнал.
set -euo pipefail

HOST="${SCRIBA_PROD_SSH:-contabo}"
REPO_URL='https://github.com/GarroV/Swarm-brain.git'
ROOT=/srv/scriba
REPO="${ROOT}/repo"
PS="bash ${REPO}/scripts/scriba-prod/stand.sh"

remote() { ssh "$HOST" "$@"; }
say() { printf '[scriba-prod %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }

in_window() {
  local hour
  hour=$(TZ=Europe/Belgrade date +%H)
  [ "$hour" -ge 23 ] || [ "$hour" -lt 7 ]
}

# Клон main на сервере: первый раз — clone, дальше — жёстко к origin/main.
sync_code() {
  remote "[ -d ${REPO}/.git ] || git clone -q ${REPO_URL} ${REPO}"
  remote "git -C ${REPO} fetch -q origin main && git -C ${REPO} checkout -q -B main origin/main && git -C ${REPO} log --oneline -1"
}

last_run() { gh run list --workflow "$1" -L 1 --json databaseId -q '.[0].databaseId // 0'; }

# Дождаться прогона, запущенного после отметки $2, и упасть, если он красный. Без отметки
# `-L 1` сразу после запуска отдаёт ПРЕДЫДУЩИЙ прогон, и зелёный старый выдал бы себя за новый.
wait_run() {
  local workflow=$1 before=$2 id tries=0
  while id=$(last_run "$workflow"); [ "$id" = "$before" ]; do
    tries=$((tries + 1))
    [ "$tries" -le 30 ] || die "новый прогон $workflow не появился за минуту"
    sleep 2
  done
  say "прогон $workflow: https://github.com/GarroV/Swarm-brain/actions/runs/$id"
  gh run watch "$id" --exit-status >/dev/null 2>&1 || {
    gh run view "$id" --log-failed 2>/dev/null | tail -15
    die "$workflow упал — дальше не иду"
  }
}

merge_prs() {
  local pr state
  for pr in ${SCRIBA_PRS:-}; do
    state=$(gh pr view "$pr" --json state -q .state)
    if [ "$state" = "OPEN" ]; then
      gh pr checks "$pr" >/dev/null || die "у PR #$pr не зелёные чеки"
      gh pr merge "$pr" --merge
      say "PR #$pr влит"
    else
      say "PR #$pr уже $state"
    fi
  done
}

deploy_functions() {
  local before
  before=$(last_run deploy-functions.yml)
  gh workflow run deploy-functions.yml --ref main -f dry_run=false -f skip_activity_check=true
  wait_run deploy-functions.yml "$before"
  say "функции раскатаны"
}

issue_token() {
  local workspace=$1 hash before
  hash=$(remote "$PS token-hash" | tr -d '\r\n')
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "сервер не отдал хеш токена"
  before=$(last_run scriba-agent-token.yml)
  gh workflow run scriba-agent-token.yml --ref main -f token_hash="$hash" -f workspace="$workspace"
  wait_run scriba-agent-token.yml "$before"
  say "токен бота записан в прод (хеш ${hash:0:8}…)"
}

case "${1:-status}" in
  rollout)
    workspace="${SCRIBA_WORKSPACE:?нужен SCRIBA_WORKSPACE — id воркспейса, который бот обслуживает}"
    in_window || [ "${FORCE:-}" = "1" ] || die "вне окна 23:00–06:59 (Белград); осознанный обход — FORCE=1"
    # До первого действия: иначе PR-ы влились бы, а остановка случилась бы уже после.
    [ "${ACTIVITY_CHECKED:-}" = "1" ] ||
      die "проверь, что в проде никто не пишет и ничего не обрабатывается, и повтори с ACTIVITY_CHECKED=1"
    command -v gh >/dev/null || die "нужен gh"
    remote "[ -s ${ROOT}/account/google-state.json ] && echo ok || echo none" | grep -q ok ||
      die "на VPS нет входа бота (${ROOT}/account/google-state.json): гостем в боевые встречи не идём"
    merge_prs
    deploy_functions
    sync_code
    issue_token "$workspace"
    remote "$PS up"
    say "готово: бот слушает приглашения. Проверка — «Позвать бота» в Swarm на тестовой встрече"
    ;;
  up)
    sync_code
    remote "$PS up"
    ;;
  status | logs | down) remote "$PS $1" ;;
  *) die "команды: rollout | up | status | logs | down" ;;
esac
