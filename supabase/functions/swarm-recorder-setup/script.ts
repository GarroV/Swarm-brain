// Bash-скрипт авто-установки SwarmRecorder (macOS, ПРЕДсобранный .app). Отдаётся функцией
// swarm-recorder-setup. Вынесен отдельно, чтобы можно было отрендерить и проверить (bash -n).
//
// Поток (Option B — prebuilt, БЕЗ Xcode/Command Line Tools на машине юзера — issue #19):
//   0. Проверить SWARM_TOKEN (^smcp_) и macOS.
//   1. Узнать последнюю сборку + URL артефакта у swarm-recorder-version.
//   2. Скачать готовый SwarmRecorder.app.zip (GitHub Release asset) → распаковать (ditto).
//   3. Снять карантин (xattr) — иначе Gatekeeper заблокирует скачанный .app.
//   4. Создать per-machine self-signed cert (штатные /usr/bin/openssl + security — CLT НЕ нужен).
//   5. Переподписать .app этим cert'ом (штатный codesign) → стабильный DR → TCC переживает апдейты.
//   6. Поставить в /Applications (с учётом lock записи), записать config.json с токеном, открыть.
//
// Почему так: CLT (git/swift) нужен ТОЛЬКО для сборки из исходников — а её мы вынесли в CI.
// codesign/security/openssl/xattr/ditto — штатные бинарники macOS, работают без CLT (проверено).

const REPO_URL = "https://github.com/GarroV/Swarm-brain";
const INGEST_BASE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1";
// Фолбэк-номер сборки, если swarm-recorder-version недоступен. Держать в синхроне с recorder/VERSION.
const RECORDER_FALLBACK_BUILD = 19;

export const SETUP_SCRIPT = `#!/bin/bash
# Swarm Brain → SwarmRecorder (macOS). Не запускай вручную — возьми команду в боте: /recordertoken
set -u

REPO_URL="${REPO_URL}"
INGEST_BASE_URL="${INGEST_BASE_URL}"
FALLBACK_BUILD="${RECORDER_FALLBACK_BUILD}"
CONFIG_DIR="$HOME/Library/Application Support/SwarmRecorder"
CONFIG="$CONFIG_DIR/config.json"
IDENTITY="SwarmRecorder Self-Signed"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
OPENSSL="/usr/bin/openssl"   # штатный LibreSSL — p12 с legacy-MAC принимается security import без -legacy

say()  { printf '%s\\n' "$*"; }
step() { printf '\\n▶ %s\\n' "$*"; }
die()  { printf '\\n❌ %s\\n' "$*" >&2; [ -n "\${TMP:-}" ] && rm -rf "$TMP"; exit 1; }

say "🎙  Swarm Brain → SwarmRecorder"
say ""
say "Что произойдёт: скачается готовое приложение (~1 МБ), локально подпишется и поставится в"
say "/Applications с уже прописанным токеном. БЕЗ Xcode, без сборки, без пароля."
say "В конце выдашь ОДНО разрешение на запись звука в System Settings."
say ""

# ── 0. Токен + macOS ────────────────────────────────────────────────────────────
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

# ── 1. Последняя сборка + URL артефакта ─────────────────────────────────────────
step "Узнаю последнюю сборку рекордера"
VER_JSON="$(curl -fsSL "$INGEST_BASE_URL/swarm-recorder-version" 2>/dev/null || true)"
BUILD="$(printf '%s' "$VER_JSON" | grep -oE '"build":[0-9]+' | grep -oE '[0-9]+' | head -1)"
URL="$(printf '%s' "$VER_JSON" | grep -oE '"url":"[^"]+"' | sed 's/^"url":"//; s/"$//' | head -1)"
[ -n "$BUILD" ] || BUILD="$FALLBACK_BUILD"
if [ -z "$URL" ]; then
  URL="$REPO_URL/releases/download/recorder-build-$BUILD/SwarmRecorder-$BUILD.zip"
fi
say "✓ Сборка $BUILD"

# ── 2. Скачиваю готовый .app и распаковываю ─────────────────────────────────────
step "Скачиваю приложение (готовая сборка, без Xcode)"
TMP="$(mktemp -d)"
ZIP="$TMP/SwarmRecorder.zip"
if ! curl -fL --retry 3 -o "$ZIP" "$URL" >/dev/null 2>&1; then
  die "Не удалось скачать приложение: $URL (нет интернета или блокирует прокси?)"
fi
if ! ditto -x -k "$ZIP" "$TMP/unz" >/dev/null 2>&1; then
  die "Не удалось распаковать загруженный архив."
fi
APP_SRC="$TMP/unz/SwarmRecorder.app"
[ -d "$APP_SRC" ] || APP_SRC="$(/usr/bin/find "$TMP/unz" -maxdepth 2 -name 'SwarmRecorder.app' -print -quit 2>/dev/null)"
[ -n "$APP_SRC" ] && [ -d "$APP_SRC" ] || die "В архиве нет SwarmRecorder.app."
say "✓ Приложение получено"

# ── 3. Снимаю карантин (иначе Gatekeeper заблокирует скачанное) ──────────────────
xattr -dr com.apple.quarantine "$APP_SRC" 2>/dev/null || true

# ── 4. Стабильный per-machine cert (штатные openssl+security, БЕЗ CLT/пароля) ────
# TCC привязывает разрешение к designated requirement (identifier + certificate leaf), не к cdhash.
# Один и тот же cert → DR стабилен → «System Audio Recording» выдаётся один раз и держится.
ensure_cert() {
  if security find-identity -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
    say "✓ Сертификат подписи уже есть"
    return 0
  fi
  [ -x "$OPENSSL" ] || die "Нет системного openssl ($OPENSSL)."
  [ -f "$KEYCHAIN" ] || die "Не найден login keychain ($KEYCHAIN)."
  say "→ Создаю сертификат подписи (без доверия и пароля)…"
  local ck cc cp12
  ck="$TMP/cs.key"; cc="$TMP/cs.crt"; cp12="$TMP/cs.p12"
  "$OPENSSL" req -x509 -newkey rsa:2048 -keyout "$ck" -out "$cc" -days 3650 -nodes \\
    -subj "/CN=$IDENTITY" \\
    -addext "basicConstraints=critical,CA:false" \\
    -addext "keyUsage=critical,digitalSignature" \\
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1 || die "Не удалось создать сертификат (openssl)."
  "$OPENSSL" pkcs12 -export -inkey "$ck" -in "$cc" -out "$cp12" -passout pass:temp -name "$IDENTITY" >/dev/null 2>&1 \\
    || die "Не удалось упаковать сертификат (p12)."
  security import "$cp12" -k "$KEYCHAIN" -P temp -T /usr/bin/codesign >/dev/null 2>&1 \\
    || die "Не удалось импортировать сертификат в keychain."
  rm -f "$ck" "$cc" "$cp12" 2>/dev/null || true
  security find-identity -p codesigning 2>/dev/null | grep -q "$IDENTITY" \\
    || die "Сертификат импортирован, но не виден в keychain."
  say "✓ Сертификат подписи готов"
}

step "Готовлю подпись (TCC-стабильность)"
ensure_cert

# ── 5. Переподписываю скачанный .app этим cert'ом (штатный codesign) ─────────────
codesign --force --timestamp=none -s "$IDENTITY" "$APP_SRC" >/dev/null 2>&1 \\
  || die "Не удалось подписать приложение (codesign)."
if ! codesign -d --requirements - "$APP_SRC" 2>&1 | grep -q 'certificate leaf'; then
  die "Подпись получилась нестабильной (DR без certificate leaf) — TCC-разрешение слетало бы. Прерываю."
fi
say "✓ Подпись стабильная — разрешение переживёт обновления"

# ── 6. Ставлю в /Applications ───────────────────────────────────────────────────
step "Ставлю в /Applications"
DEST="/Applications/SwarmRecorder.app"
LOCK="$CONFIG_DIR/.recording"
rm -rf "$DEST" 2>/dev/null || true
cp -R "$APP_SRC" "$DEST" || die "Не удалось скопировать в /Applications."
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# ── 7. Токен в конфиг (форма SwarmConfig) ───────────────────────────────────────
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

# Перезапуск (во время записи — не трогаем, чтобы не оборвать встречу).
if [ -f "$LOCK" ]; then
  say "⚠ Идёт запись — установлено, но НЕ перезапускаю. После встречи: ⌘Q рекордера и открой заново."
else
  if pgrep -x "SwarmRecorder" >/dev/null 2>&1; then
    osascript -e 'quit app "SwarmRecorder"' >/dev/null 2>&1 || true
    pkill -x SwarmRecorder 2>/dev/null || true
    sleep 1
  fi
  open "$DEST" >/dev/null 2>&1 || true
fi

rm -rf "$TMP"

# ── 8. Финальное сообщение ──────────────────────────────────────────────────────
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
