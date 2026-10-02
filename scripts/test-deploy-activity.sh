#!/usr/bin/env bash
# Коды возврата deploy-activity.sh на подставном `supabase` (issues #437, #438).
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
  mkdir -p "$tmp/scripts" "$tmp/supabase/.temp" "$tmp/bin"
  cp "$SRC" "$tmp/scripts/"
  echo "postgres://stub" > "$tmp/supabase/.temp/pooler-url"
  cat > "$tmp/bin/supabase" <<STUB
#!/usr/bin/env bash
case "$mode" in
  fail) echo "unexpected login role status 403" >&2; exit 1 ;;
  recording) case "\$*" in *recording*) echo '{"rows":[{"recording":1,"processing":0}]}' ;; *) echo '{"rows":[]}' ;; esac ;;
  people) case "\$*" in *recording*) echo '{"rows":[{"recording":0,"processing":0}]}' ;; *) echo '{"rows":[{"who":"A","what":"задачи","n":1,"last_seen":"02:00"}]}' ;; esac ;;
  fail-people) case "\$*" in *recording*) echo '{"rows":[{"recording":0,"processing":0}]}' ;; *) exit 1 ;; esac ;;
  clean) case "\$*" in *recording*) echo '{"rows":[{"recording":0,"processing":0}]}' ;; *) echo '{"rows":[]}' ;; esac ;;
esac
STUB
  chmod +x "$tmp/bin/supabase"
  PATH="$tmp/bin:$PATH" bash "$tmp/scripts/deploy-activity.sh" >/dev/null 2>&1
  got=$?
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then
    echo "ok    $name → $got"
  else
    echo "ОШИБКА $name: ждали $want, получили $got"
    FAILED=1
  fi
}

run_case "запрос встреч не прошёл" 3 fail
run_case "запрос людей не прошёл" 3 fail-people
run_case "идёт запись" 2 recording
run_case "люди работают" 1 people
run_case "чисто" 0 clean
exit $FAILED
