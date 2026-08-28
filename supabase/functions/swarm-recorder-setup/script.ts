// Bash-скрипт авто-установки bumblebee — рекордера встреч (macOS, ПРЕДсобранный .app). Отдаётся функцией
// swarm-recorder-setup. Вынесен отдельно, чтобы можно было отрендерить и проверить (bash -n).
//
// Поток (Option B — prebuilt, БЕЗ Xcode/Command Line Tools на машине юзера — issue #19):
//   0. Проверить SWARM_TOKEN (^smcp_) и macOS.
//   1. Узнать последнюю сборку + URL артефакта у swarm-recorder-version.
//   2. Скачать готовый .app в zip → распаковать (ditto). Имя бандла в архиве переходное
//      (SwarmRecorder.app, см. recorder/build-app-ci.sh) — принимаем и его, и bumblebee.app.
//   3. Снять карантин (xattr) — иначе Gatekeeper заблокирует скачанный .app.
//   4. Создать per-machine self-signed cert (штатные /usr/bin/openssl + security — CLT НЕ нужен).
//   5. Переподписать .app этим cert'ом (штатный codesign) → стабильный DR → TCC переживает апдейты.
//   6. Поставить в /Applications (с учётом lock записи), записать config.json с токеном, открыть.
//
// Почему так: CLT (git/swift) нужен ТОЛЬКО для сборки из исходников — а её мы вынесли в CI.
// codesign/security/openssl/xattr/ditto — штатные бинарники macOS, работают без CLT (проверено).

// Готовый .app раздаётся из ПУБЛИЧНОГО бакета Storage, а не из GitHub Release (issue #91):
// репозиторий приватный с 20.08.2026 → анонимный curl за release asset получает 404, и установка
// падала у каждого нового человека. Канон источника — `swarm-recorder-version` (поле `url`);
// строка ниже нужна только как фолбэк, если функция версии недоступна.
const ASSET_BASE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/public/swarm_drive/recorder";
const INGEST_BASE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1";
// Фолбэк-номер сборки, если swarm-recorder-version недоступен. Держать в синхроне с recorder/VERSION.
const RECORDER_FALLBACK_BUILD = 25;

export const SETUP_SCRIPT = `#!/bin/bash
# Swarm Brain → bumblebee (macOS). Не запускай вручную — возьми команду в боте: /recordertoken
set -u

ASSET_BASE_URL="${ASSET_BASE_URL}"
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

say "🎙  Swarm Brain → bumblebee"
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
  URL="$ASSET_BASE_URL/SwarmRecorder-$BUILD.zip"
fi
say "✓ Сборка $BUILD"

# ── 2. Скачиваю готовый .app и распаковываю ─────────────────────────────────────
step "Скачиваю приложение (готовая сборка, без Xcode)"
TMP="$(mktemp -d)"
ZIP="$TMP/SwarmRecorder.zip"
# Различаем «файла нет по ссылке» и «сети нет»: раньше обе ветки врали про интернет/прокси,
# и диагностика уходила не туда (issue #91 — реальной причиной была приватность репозитория).
# Флаг --retry печатает %{http_code} за КАЖДУЮ попытку («000000» при обрыве сети) — берём последние 3.
HTTP_CODE="$(curl -sL --retry 3 -o "$ZIP" -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
HTTP_CODE="\${HTTP_CODE: -3}"
case "$HTTP_CODE" in
  200) ;;
  000) die "Не удалось связаться с сервером раздачи: $URL (нет интернета или блокирует прокси?)";;
  403|404) die "Сборка $BUILD недоступна по ссылке (HTTP $HTTP_CODE): $URL
Это не твой интернет — файл не опубликован или ссылка протухла. Покажи эту ошибку владельцу Swarm.";;
  *) die "Сервер раздачи ответил HTTP $HTTP_CODE: $URL";;
esac
if ! ditto -x -k "$ZIP" "$TMP/unz" >/dev/null 2>&1; then
  die "Не удалось распаковать загруженный архив."
fi
APP_SRC=""
for CAND in "$TMP/unz/bumblebee.app" "$TMP/unz/SwarmRecorder.app"; do
  [ -d "$CAND" ] && { APP_SRC="$CAND"; break; }
done
[ -n "$APP_SRC" ] || APP_SRC="$(/usr/bin/find "$TMP/unz" -maxdepth 2 -name 'bumblebee.app' -print -quit 2>/dev/null)"
[ -n "$APP_SRC" ] || APP_SRC="$(/usr/bin/find "$TMP/unz" -maxdepth 2 -name 'SwarmRecorder.app' -print -quit 2>/dev/null)"
[ -n "$APP_SRC" ] && [ -d "$APP_SRC" ] || die "В архиве нет приложения (.app)."
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
DEST="/Applications/bumblebee.app"
LEGACY_DEST="/Applications/SwarmRecorder.app"
LOCK="$CONFIG_DIR/.recording"
rm -rf "$DEST" 2>/dev/null || true
cp -R "$APP_SRC" "$DEST" || die "Не удалось скопировать в /Applications."
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
# Копия под прежним именем осталась бы вторым рекордером и писала бы те же встречи параллельно.
if [ -d "$LEGACY_DEST" ]; then
  rm -rf "$LEGACY_DEST" 2>/dev/null || true
  say "✓ Прежняя копия (SwarmRecorder.app) убрана"
fi

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
  say "⚠ Идёт запись — установлено, но НЕ перезапускаю. После встречи: ⌘Q bumblebee и открой заново."
else
  # Имя ПРОЦЕССА осталось прежним (CFBundleExecutable не трогали, чтобы не сбросить TCC),
  # поэтому глушим по нему; osascript пробуем на оба имени бандла — старое и новое.
  if pgrep -x "SwarmRecorder" >/dev/null 2>&1; then
    osascript -e 'quit app "bumblebee"' >/dev/null 2>&1 || true
    osascript -e 'quit app "SwarmRecorder"' >/dev/null 2>&1 || true
    pkill -x SwarmRecorder 2>/dev/null || true
    sleep 1
  fi
  open "$DEST" >/dev/null 2>&1 || true
fi

rm -rf "$TMP"

# ── 8. Финальное сообщение ──────────────────────────────────────────────────────
say ""
say "✅ Готово! bumblebee установлен в /Applications и запущен (иконка в меню-баре, токен уже прописан)."
say ""
say "Остался ОДИН шаг — выдать разрешение на запись системного звука:"
say "  1. System Settings → Privacy & Security → Screen & System Audio Recording →"
say "     включи bumblebee (это же — пункт меню «Открыть настройки записи»)."
say "  2. Затем ВЫЙДИ из bumblebee (⌘Q в его меню) и открой заново —"
say "     macOS применяет это разрешение только после перезапуска приложения."
say ""
say "Дальше: «Записать встречу» в меню (вручную) или по уведомлению о звонке."
say "Разрешение выдаётся ОДИН раз и держится между обновлениями (стабильная подпись)."
`;
