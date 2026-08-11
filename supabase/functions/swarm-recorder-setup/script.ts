// Bash-скрипт авто-установки SwarmRecorder (macOS, сборка из исходников). Отдаётся функцией
// swarm-recorder-setup. Вынесен отдельно, чтобы можно было отрендерить и проверить (bash -n).
//
// Поток (Option A — build-from-source):
//   1. Проверить SWARM_TOKEN (^smcp_).
//   2. Headless Command Line Tools (Homebrew-техника softwareupdate; fallback xcode-select --install).
//   3. git clone --depth 1 публичного репо → cd recorder.
//   4. ./setup-signing.sh — создать+доверить стабильному self-signed cert (один запрос пароля).
//   5. ./install.sh — собрать, подписать cert'ом, поставить в /Applications, открыть.
//   6. Записать ~/Library/Application Support/SwarmRecorder/config.json с токеном (форма SwarmConfig).
//   7. Финальное сообщение: какое разрешение выдать, Quit & Reopen.
//
// Честно: один скачивание Command Line Tools (если их нет) + один запрос пароля для cert.

const REPO_URL = "https://github.com/GarroV/Swarm-brain";
const INGEST_BASE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1";

export const SETUP_SCRIPT = `#!/bin/bash
# Swarm Brain → SwarmRecorder (macOS). Не запускай вручную — возьми команду в боте: /recordertoken
set -u

REPO_URL="${REPO_URL}"
REPO_BRANCH="main"
REPO_BRANCH_FALLBACK="sandbox_vas"   # переходный fallback на старое имя ветки (до ренейма sandbox_vas → main)
INGEST_BASE_URL="${INGEST_BASE_URL}"
CONFIG_DIR="$HOME/Library/Application Support/SwarmRecorder"
CONFIG="$CONFIG_DIR/config.json"
CLT_GIT="/Library/Developer/CommandLineTools/usr/bin/git"

say()  { printf '%s\\n' "$*"; }
step() { printf '\\n▶ %s\\n' "$*"; }
die()  { printf '\\n❌ %s\\n' "$*" >&2; [ -n "\${TMP:-}" ] && rm -rf "$TMP"; exit 1; }

say "🎙  Swarm Brain → SwarmRecorder (сборка из исходников)"
say ""
say "Что произойдёт: при необходимости один раз скачаются Command Line Tools (с паролем, если их нет);"
say "затем локально создастся сертификат подписи, приложение соберётся и поставится в /Applications"
say "с уже прописанным токеном — БЕЗ запросов пароля. В конце выдашь разрешение на запись в System Settings."
say ""

# ── 0. Токен ──────────────────────────────────────────────────────────────────
if [ -z "\${SWARM_TOKEN:-}" ]; then
  die "Нет токена. Возьми свежую команду в боте — она содержит токен (/recordertoken)."
fi
case "$SWARM_TOKEN" in
  smcp_*) ;;
  *) die "Токен выглядит неправильно (должен начинаться с smcp_). Возьми свежую команду (/recordertoken).";;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  die "Это установщик только для macOS."
fi
ARCH="$(uname -m)"
say "✓ Токен принят · macOS · arch=$ARCH"

# ── 1. Command Line Tools (headless, иначе fallback) ────────────────────────────
have_clt() {
  [ -e "$CLT_GIT" ] && return 0
  xcode-select -p >/dev/null 2>&1 && command -v swift >/dev/null 2>&1 && swift --version >/dev/null 2>&1
}

install_clt_headless() {
  # Техника Homebrew: placeholder заставляет softwareupdate показать CLT в списке,
  # затем ставим найденный label без открытия GUI-установщика.
  local placeholder label
  placeholder="/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"
  touch "$placeholder" 2>/dev/null || true
  # Строки вида: "* Label: Command Line Tools for Xcode-16.2". Вытаскиваем сам label,
  # отсеиваем beta, берём самую свежую версию.
  label="$(softwareupdate -l 2>/dev/null \\
    | grep -E '^[[:space:]]*\\*.*Command Line Tools' \\
    | sed -E 's/^[[:space:]]*\\*[[:space:]]*Label:[[:space:]]*//' \\
    | grep -iv beta \\
    | sort -V \\
    | tail -n1)"
  if [ -n "$label" ]; then
    say "⏳ Ставлю Command Line Tools: \\"$label\\" (может занять несколько минут)…"
    sudo softwareupdate -i "$label" --verbose
  fi
  rm -f "$placeholder" 2>/dev/null || true
}

install_clt_fallback() {
  # GUI-триггер + ожидание: пользователь жмёт «Установить», мы поллим готовность.
  say "⏳ Открываю установщик Command Line Tools (нажми «Установить» в окне)…"
  xcode-select --install >/dev/null 2>&1 || true
  local tries=0
  while ! have_clt; do
    tries=$((tries + 1))
    if [ "$tries" -gt 120 ]; then   # ~20 минут (120 × 10 с)
      die "Command Line Tools так и не установились. Поставь вручную (xcode-select --install) и запусти снова."
    fi
    sleep 10
  done
}

# Реально ли тулчейн СОБИРАЕТ пакет? have_clt подтверждает лишь наличие swift, но НЕ способность
# собрать: на битых/устаревших CLT манифест Package.swift не линкуется с PackageDescription под arm64
# (реальный кейс 2026-08-11). Пробуем собрать крошечный пакет — ловим проблему ДО клона и даём действие.
toolchain_can_build() {
  local d
  d="$(mktemp -d)" || return 1
  mkdir -p "$d/Sources/probe"
  printf '// swift-tools-version:5.9\\nimport PackageDescription\\nlet package = Package(name: "probe", targets: [.executableTarget(name: "probe")])\\n' > "$d/Package.swift"
  printf 'print("ok")\\n' > "$d/Sources/probe/main.swift"
  if ( cd "$d" && swift build >/dev/null 2>&1 ); then rm -rf "$d"; return 0; fi
  rm -rf "$d"
  return 1
}

# Переустановка CLT — ТОЛЬКО если xcode-select смотрит на CommandLineTools (не на полноценный Xcode.app),
# иначе rm -rf порвёт связку с Xcode. Возвращает 0, если после переустановки swift снова на месте.
repair_clt() {
  local dev
  dev="$(xcode-select -p 2>/dev/null || true)"
  case "$dev" in
    */CommandLineTools*) ;;
    *) return 1 ;;
  esac
  say "⟳ Переустанавливаю Command Line Tools (текущие не собирают проект)…"
  sudo rm -rf /Library/Developer/CommandLineTools 2>/dev/null || true
  install_clt_headless
  have_clt || install_clt_fallback
  have_clt
}

if have_clt; then
  say "✓ Command Line Tools уже установлены"
else
  step "Ставлю Command Line Tools (один раз)"
  install_clt_headless
  if ! have_clt; then
    say "⚠ Headless-установка не сработала — пробую через GUI-установщик."
    install_clt_fallback
  fi
  have_clt || die "Command Line Tools недоступны после установки."
  say "✓ Command Line Tools готовы"
fi

# git/swift нужны для сборки
command -v git   >/dev/null 2>&1 || die "git не найден (нужны Command Line Tools)."
command -v swift >/dev/null 2>&1 || die "swift не найден (нужны Command Line Tools)."

# ── 1b. Тулчейн реально СОБИРАЕТ? (не только «swift есть») ───────────────────────
if ! toolchain_can_build; then
  say "⚠ Command Line Tools есть, но не собирают Swift-проект (повреждены/устарели)."
  if repair_clt && toolchain_can_build; then
    say "✓ Command Line Tools восстановлены"
  else
    die "Command Line Tools повреждены и не собирают Swift-проект. Почини вручную и запусти команду снова:
  sudo rm -rf /Library/Developer/CommandLineTools
  sudo xcode-select --install
(нажми «Установить», дождись конца установки). Если на маке стоит полноценный Xcode:
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  fi
fi

# ── 2. Клон публичного репозитория ──────────────────────────────────────────────
step "Скачиваю исходники"
TMP="$(mktemp -d)"
if ! git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TMP/src" >/dev/null 2>&1; then
  # ветки main нет (ещё не переименована) → пробуем старое имя
  if ! git clone --depth 1 --branch "$REPO_BRANCH_FALLBACK" "$REPO_URL" "$TMP/src" >/dev/null 2>&1; then
    die "Не удалось склонировать репозиторий (нет интернета или блокирует прокси): $REPO_URL"
  fi
fi
RECORDER_DIR="$TMP/src/recorder"
[ -d "$RECORDER_DIR" ] || die "В репозитории нет папки recorder/ — структура изменилась?"
cd "$RECORDER_DIR" || die "Не удалось перейти в $RECORDER_DIR"
say "✓ Исходники получены"

# ── 3. Стабильный сертификат подписи (неинтерактивно — без доверия/пароля) ───────
step "Готовлю сертификат подписи (TCC-стабильность)"
[ -f ./setup-signing.sh ] || die "Нет setup-signing.sh в recorder/."
chmod +x ./setup-signing.sh 2>/dev/null || true
if ! ./setup-signing.sh; then
  die "Не удалось создать сертификат подписи. См. сообщение выше."
fi

# ── 4. Сборка + установка + запуск ──────────────────────────────────────────────
step "Собираю и ставлю приложение"
[ -f ./install.sh ] || die "Нет install.sh в recorder/."
chmod +x ./install.sh ./build-app.sh 2>/dev/null || true
if ! ./install.sh; then
  die "Сборка/установка не удалась. См. сообщение выше."
fi

# ── 5. Прописываем config.json с токеном (форма SwarmConfig) ─────────────────────
step "Прописываю токен в конфиг"
mkdir -p "$CONFIG_DIR" || die "Не удалось создать $CONFIG_DIR"
TOKEN_ESC="\${SWARM_TOKEN//\\\\/\\\\\\\\}"; TOKEN_ESC="\${TOKEN_ESC//\\"/\\\\\\"}"
cat > "$CONFIG" <<EOF || die "Не удалось записать $CONFIG"
{
  "token": "$TOKEN_ESC",
  "ingestBaseURL": "$INGEST_BASE_URL",
  "webBaseURL": ""
}
EOF
say "✓ Конфиг записан: $CONFIG"

# приложение перезапустить, чтобы оно подхватило свежий config.json
if pgrep -x "SwarmRecorder" >/dev/null 2>&1; then
  osascript -e 'quit app "SwarmRecorder"' >/dev/null 2>&1 || true
  sleep 1
fi
open "/Applications/SwarmRecorder.app" >/dev/null 2>&1 || true

rm -rf "$TMP"

# ── 6. Финальное сообщение ──────────────────────────────────────────────────────
say ""
say "✅ Готово! SwarmRecorder установлен в /Applications и запущен (иконка в меню-баре, токен уже прописан)."
say ""
say "Остался ОДИН шаг — выдать разрешение на запись системного звука:"
say "  1. System Settings → Privacy & Security → Screen & System Audio Recording →"
say "     включи SwarmRecorder (это же — пункт меню рекордера «Открыть настройки записи»)."
say "  2. Затем ВЫЙДИ из рекордера (⌘Q в его меню) и открой заново —"
say "     macOS применяет это разрешение только после перезапуска приложения."
say ""
say "Дальше: «Записать встречу» в меню (вручную) или по уведомлению о звонке."
say "Разрешение выдаётся ОДИН раз и держится между обновлениями (стабильная подпись)."
`;
