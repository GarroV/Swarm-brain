# Вызов шлюза раскатки на своём сервере Swarm (issue #919; сам шлюз — deploy/server/gate.sh).
# Подключается через `source` из scripts/deploy-window.sh, scripts/lib/migrations-gate.sh и
# scripts/migrate-server.sh.
#
#   swarm_server functions            < tar.gz каталога supabase/functions
#   swarm_server migrations-applied
#   swarm_server migrate <версия> <имя> < файл.sql
#
# Ключ у шлюза принудительный: на сервере он может запустить только эти три команды.
# Настройка (все переменные необязательны):
#   SWARM_DEPLOY_HOST                 — адрес сервера (по умолчанию VPS Contabo)
#   SWARM_DEPLOY_KEY_FILE             — приватный ключ (по умолчанию ~/Documents/workbench/private/swarm-deploy-key)
#   SWARM_DEPLOY_KNOWN_HOSTS_FILE     — known_hosts (в CI его пишет .github/actions/swarm-deploy-ssh); без него — обычный
# Коды: код команды шлюза; 3 — ключа нет (проверить/раскатать нечем); 255 — ssh не дозвонился.

swarm_server() {
  local key="${SWARM_DEPLOY_KEY_FILE:-$HOME/Documents/workbench/private/swarm-deploy-key}"
  local host="${SWARM_DEPLOY_HOST:-95.111.249.216}"
  local -a opts=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15)
  if [ ! -r "$key" ]; then
    echo "swarm_server: нет ключа раскатки ($key). В CI его пишет шаг swarm-deploy-ssh из секретов; на pull_request от форка секретов нет." >&2
    return 3
  fi
  if [ -n "${SWARM_DEPLOY_KNOWN_HOSTS_FILE:-}" ]; then
    opts+=(-o "UserKnownHostsFile=$SWARM_DEPLOY_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes)
  fi
  ssh "${opts[@]}" "swarm-deploy@$host" "$@"
}
