#!/usr/bin/env bash
# Вход аккаунта бота scriba (T175) на MUSPELHEIM — управление с Мака одной командой.
#
#   scripts/scriba-login.sh login        — обновить код, собрать образы, открыть окно входа
#                                          и напечатать ОДНУ ссылку для владельца
#   scripts/scriba-login.sh status       — открыто ли окно, сохранён ли вход (без содержимого)
#   scripts/scriba-login.sh close        — погасить окно входа, ничего не сохраняя
#   scripts/scriba-login.sh smoke [сц.]  — смоуки адаптера Meet и входа на настоящем Docker
#   scripts/scriba-login.sh down         — погасить своё на сервере, вход оставить
#   scripts/scriba-login.sh wipe [account] — стереть образы и клон (с account — и сохранённый вход)
#
# Владелец открывает ссылку в своём браузере (только из сети Tailscale), входит в Google за
# бота сам — пароль и второй фактор не проходят ни через этот скрипт, ни через логи, — и
# закрывает окно браузера крестиком: вход выгружается сам. Итог — `status`.
#
# Код на сервер попадает клоном ветки из origin, не с диска Мака: сначала запушь.
# Ветка — SCRIBA_LOGIN_BRANCH (по умолчанию feat/bot-google-login).
set -euo pipefail

HOST="${SCRIBA_LOGIN_SSH:-muspelheim}"
BRANCH="${SCRIBA_LOGIN_BRANCH:-feat/bot-google-login}"
ROOT='C:\projects\scriba-login'
REPO="${ROOT}\\repo"
PS="pwsh -NoProfile -File ${REPO}\\scripts\\scriba-login\\stand.ps1"
ORIGIN="$(git remote get-url origin)"

remote() { ssh "$HOST" "$@"; }

sync_code() {
  local remote_head
  remote_head="$(git ls-remote origin "refs/heads/${BRANCH}" | cut -f1)"
  if [ -z "$remote_head" ]; then
    echo "✘ ветки ${BRANCH} нет в origin — запушь её: git push -u origin ${BRANCH}" >&2
    exit 1
  fi
  if [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && [ "$(git rev-parse HEAD)" != "$remote_head" ]; then
    echo "⚠ локальный HEAD не равен origin/${BRANCH}: на сервер едет origin" >&2
  fi
  remote "if not exist ${REPO}\\.git git clone -q --branch ${BRANCH} ${ORIGIN} ${REPO}"
  remote "git -C ${REPO} fetch -q origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH} && git -C ${REPO} checkout -q -B ${BRANCH} origin/${BRANCH} && git -C ${REPO} log --oneline -1"
}

case "${1:-status}" in
  login)
    sync_code
    remote "$PS build"
    remote "$PS login"
    ;;
  status) remote "$PS login-status" ;;
  close) remote "$PS login-close" ;;
  smoke)
    sync_code
    remote "$PS build"
    remote "$PS smoke ${2:-}"
    ;;
  down) remote "$PS down" ;;
  wipe) remote "$PS wipe ${2:-}" ;;
  *)
    sed -n '2,17p' "$0"
    exit 1
    ;;
esac
