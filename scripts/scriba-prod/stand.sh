#!/usr/bin/env bash
# Боевой бот встреч scriba — серверная половина, запускается на VPS Contabo (с 30.09.2026, D039;
# до этого — MUSPELHEIM, stand.ps1). С Мака её зовёт scripts/scriba-prod.sh по ssh; руками —
# только если Мака под рукой нет:
#   bash /srv/scriba/repo/scripts/scriba-prod/stand.sh <команда>
#
# Команды:
#   token-hash — родить токен бота, если его ещё нет, и напечатать ТОЛЬКО его sha256-hex
#   up         — собрать образ с текущего клона и поднять оркестратор
#   status     — идёт ли оркестратор, чей код, сколько встреч сейчас
#   logs       — последние строки журнала оркестратора
#   down       — погасить оркестратор и встречи; токен и вход не трогать
#
# Своё на общей площадке: папка /srv/scriba (repo — клон main, state — данные вне git, account —
# вход Google-аккаунта бота), compose-проект scriba-prod, контейнеры scriba-prod-*. Портов нет:
# бот сам ходит в Swarm, входящих соединений не ждёт. Чужое не трогаем.
# Токен не покидает эту машину: наружу уходит только хеш, по нему прод узнаёт бота.
set -euo pipefail

ROOT=/srv/scriba
REPO="$ROOT/repo"
STATE="$ROOT/state"
ACCOUNT_DIR="$ROOT/account"
COMPOSE="$REPO/scripts/scriba-prod/compose.yml"
ENV_FILE="$STATE/prod.env"
# Канал FURCA (/srv/furca-channel): контейнер и его сеть — для предупреждений владельцу (#861).
ALERT_CHANNEL_CONTAINER=furca-channel-bot-1
ALERT_CHANNEL_NETWORK=furca-channel_default
TOKEN_FILE="$STATE/bot.token"
PROJECT=scriba-prod
SWARM_URL='https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1'
# VPS общий: встреча берёт до 2 ГБ и 2 ядер, четыре сразу задушили бы соседей.
MAX_MEETINGS=3

say() { printf '[scriba-prod %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }
dc() { docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" "$@"; }

# Каталог только для владельца: токен и вход бота никто, кроме него, читать не должен.
protect() { mkdir -p "$1" && chmod 700 "$1"; }

read_token() {
  [ -s "$TOKEN_FILE" ] || die "токена бота нет: сперва stand.sh token-hash и запись хеша в прод"
  tr -d '\r\n' < "$TOKEN_FILE"
}

token_hash() {
  protect "$STATE"
  if [ ! -s "$TOKEN_FILE" ]; then
    # 32 случайных байта в hex: перебором не достать, а по хешу сервер узнаёт бота.
    (umask 077 && printf 'scriba_%s' "$(openssl rand -hex 32)" > "$TOKEN_FILE")
  fi
  printf '%s' "$(read_token)" | sha256sum | cut -d' ' -f1
}

prod_up() {
  [ -s "$ACCOUNT_DIR/google-state.json" ] ||
    die "входа бота нет ($ACCOUNT_DIR/google-state.json): гостем в боевые встречи не идём"
  protect "$STATE"
  mkdir -p "$STATE/lease" "$STATE/account-copies" "$STATE/runs"
  local token rev version image egress_extra=""
  token=$(read_token)
  # Добавка к списку выхода встреч наружу (T178): одна строка «host:port,host:port» в
  # $STATE/egress-extra. Нужна, когда живой встрече не хватило хоста (медиасерверы Толка, T111):
  # его имя стоит в строке «egress deny» журнала прокси scriba-prod-egress.
  [ -f "$STATE/egress-extra" ] && egress_extra=$(tr -d '[:space:]' < "$STATE/egress-extra")
  # Срочные предупреждения владельцу (#861): секрет канала FURCA — в $STATE/alert-channel.secret
  # (права 600), канал — соседний контейнер на этом же сервере, оркестратор цепляется к его сети.
  local alert_url="" alert_secret=""
  if [ -f "$STATE/alert-channel.secret" ]; then
    alert_secret=$(tr -d '[:space:]' < "$STATE/alert-channel.secret")
    alert_url="http://$ALERT_CHANNEL_CONTAINER:8090"
  fi
  rev=$(git -C "$REPO" rev-parse --short HEAD)
  version=$(git -C "$REPO" rev-list --count HEAD)
  image="scriba-prod:$rev"
  say "код: $rev ($(git -C "$REPO" rev-parse --abbrev-ref HEAD)), сборка $version"
  docker build -q -f "$REPO/bot/container/Dockerfile" -t "$image" "$REPO/bot" >/dev/null
  # На Linux путь для демона Docker совпадает с путём на машине — отдельных «daemon»-путей,
  # как у Docker Desktop на Windows, не нужно.
  (umask 077 && cat > "$ENV_FILE" <<EOF
SCRIBA_IMAGE=$image
SCRIBA_SWARM_URL=$SWARM_URL
SCRIBA_BOT_TOKEN=$token
SCRIBA_BOT_VERSION=$version
SCRIBA_MAX_MEETINGS=$MAX_MEETINGS
SCRIBA_EGRESS_EXTRA=$egress_extra
PROD_STATE_DIR=$STATE
PROD_ACCOUNT_DIR=$ACCOUNT_DIR
PROD_LEASE_DAEMON_DIR=$STATE/lease
PROD_ACCOUNT_COPIES_DAEMON_DIR=$STATE/account-copies
SCRIBA_ALERT_CHANNEL_URL=$alert_url
SCRIBA_ALERT_CHANNEL_SECRET=$alert_secret
EOF
  )
  dc up -d --force-recreate orchestrator >/dev/null
  if [ -n "$alert_url" ]; then
    docker network connect "$ALERT_CHANNEL_NETWORK" "$PROJECT-orchestrator-1" 2>/dev/null ||
      say "ВНИМАНИЕ: сеть канала FURCA $ALERT_CHANNEL_NETWORK не подключена — предупреждения владельцу не дойдут"
  else
    say "ВНИМАНИЕ: нет $STATE/alert-channel.secret — предупреждения владельцу о тишине только в журнале"
  fi
  sleep 15
  show_status
}

show_status() {
  local state
  state=$(docker inspect -f '{{.State.Status}} {{.Config.Image}} с {{.State.StartedAt}}' "$PROJECT-orchestrator-1" 2>/dev/null) ||
    { say 'оркестратор не поднят'; return; }
  say "оркестратор: $state"
  say "встреч идёт: $(docker ps -q --filter "label=scriba.project=$PROJECT" --filter name=meeting | wc -l | tr -d ' ')"
  say 'журнал (последние строки):'
  docker logs --tail 8 "$PROJECT-orchestrator-1" 2>&1 | sed 's/^/  /'
}

prod_down() {
  [ -f "$ENV_FILE" ] && dc down >/dev/null
  docker ps -aq --filter "label=scriba.project=$PROJECT" | xargs -r docker rm -f >/dev/null
  # Прокси выхода поднимает оркестратор, и метка у него своя — scriba.egress-of, а не
  # scriba.project (bot/src/orchestrator/egress.ts). Без этой строки он переживает down (#634).
  docker ps -aq --filter "label=scriba.egress-of=$PROJECT" | xargs -r docker rm -f >/dev/null
  say 'оркестратор, встречи и прокси выхода погашены; токен и вход бота не тронуты'
}

case "${1:-status}" in
  token-hash) token_hash ;;
  up) prod_up ;;
  status) show_status ;;
  logs) docker logs --tail 60 "$PROJECT-orchestrator-1" 2>&1 ;;
  down) prod_down ;;
  *) die "неизвестная команда «$1»: token-hash | up | status | logs | down" ;;
esac
