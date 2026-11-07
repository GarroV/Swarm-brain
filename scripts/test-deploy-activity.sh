#!/usr/bin/env bash
# Коды возврата deploy-activity.sh на подставном `ssh` (шлюз `swarm_server activity`) (issues #437, #438).
# Главное, что проверяем: упавший запрос к проду — это «не смог проверить» (3), а не
# «люди работают» (1), который обходится FORCE=1.
#
#   ./scripts/test-deploy-activity.sh
set -uo pipefail
cd "$(dirname "$0")/.."
SRC=scripts/deploy-activity.sh
FAILED=0

run_case() { # имя, ожидаемый код, режим заглушки
  local name=$1 want=$2 mode=$3 tmp got
  tmp=$(mktemp -d)
  mkdir -p "$tmp/scripts/lib" "$tmp/bin"
  cp "$SRC" "$tmp/scripts/"
  cp scripts/lib/swarm-server.sh "$tmp/scripts/lib/"
  echo "stub-key" > "$tmp/key"
  # Подставной ssh отвечает так, как ответил бы шлюз: строки TSV; сам вызов пишет в $tmp/calls.
  cat > "$tmp/bin/ssh" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$tmp/calls"
case "$mode" in
  fail) echo "ssh: connect to host: Connection refused" >&2; exit 255 ;;
  garbage) echo "что-то не то" ;;
  no-processing) printf 'recording\t0\n' ;;
  recording) printf 'recording\t1\nprocessing\t0\n' ;;
  processing) printf 'recording\t0\nprocessing\t2\n' ;;
  people) printf 'recording\t0\nprocessing\t0\nperson\tA B\tзадачи\t1\t02:00\n' ;;
  bad-person) printf 'recording\t0\nprocessing\t0\nperson\tобрезано\n' ;;
  clean) printf 'recording\t0\nprocessing\t0\n' ;;
esac
STUB
  chmod +x "$tmp/bin/ssh"
  SWARM_DEPLOY_KEY_FILE="$tmp/key" PATH="$tmp/bin:$PATH" bash "$tmp/scripts/deploy-activity.sh" >/dev/null 2>&1
  got=$?
  if ! grep -q ' activity$' "$tmp/calls" 2>/dev/null; then echo "ОШИБКА $name: шлюзу не ушла команда activity"; FAILED=1; fi
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then
    echo "ok    $name → $got"
  else
    echo "ОШИБКА $name: ждали $want, получили $got"
    FAILED=1
  fi
}

run_case "шлюз не ответил" 3 fail
run_case "ответ нечитаем" 3 garbage
run_case "в ответе нет processing" 3 no-processing
run_case "повреждённая строка человека — считаем, что люди есть" 1 bad-person
run_case "идёт запись" 2 recording
run_case "обработка встречи" 2 processing
run_case "люди работают" 1 people
run_case "чисто" 0 clean
exit $FAILED
