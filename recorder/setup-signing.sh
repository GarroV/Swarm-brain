#!/bin/bash
# Создаёт и доверяет стабильному self-signed code-signing cert «SwarmRecorder Self-Signed».
# Зачем: macOS привязывает TCC-разрешения (Screen & System Audio Recording и пр.) к designated
# requirement подписи = identifier + certificate leaf, а НЕ к cdhash. С одним стабильным cert
# разрешение выдаётся ОДИН раз и держится между пересборками. Ad-hoc (-s -) cert не имеет → DR
# схлопывается в cdhash → грант слетает каждую сборку. Подробнее — recorder/README.md.
#
# Идемпотентно: если cert уже есть в keychain — выходим сразу.
# Один привилегированный шаг — sudo security add-trusted-cert (попросит пароль один раз).
set -euo pipefail

IDENTITY="SwarmRecorder Self-Signed"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# Системный /usr/bin/openssl — это LibreSSL: он пишет p12 с legacy-MAC, который `security import`
# принимает БЕЗ флага -legacy (в отличие от Homebrew OpenSSL 3, требующего -legacy/-macalg sha1).
OPENSSL="/usr/bin/openssl"

# ── 0. Уже есть? ────────────────────────────────────────────────────────────────
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  echo "[signing] cert «$IDENTITY» уже в keychain — пропускаю."
  exit 0
fi

if [ ! -x "$OPENSSL" ]; then
  echo "[signing] ОШИБКА: нет системного openssl ($OPENSSL)." >&2
  exit 1
fi
if [ ! -f "$KEYCHAIN" ]; then
  echo "[signing] ОШИБКА: не найден login keychain ($KEYCHAIN)." >&2
  exit 1
fi

echo "[signing] создаю self-signed code-signing cert «$IDENTITY»…"

TMP="$(mktemp -d)"
cleanup() { rm -f "$TMP/cs.key" "$TMP/cs.crt" "$TMP/cs.p12" 2>/dev/null || true; rmdir "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

KEY="$TMP/cs.key"
CRT="$TMP/cs.crt"
P12="$TMP/cs.p12"

# ── 1. Самоподписанный сертификат (code signing EKU) ─────────────────────────────
"$OPENSSL" req -x509 -newkey rsa:2048 -keyout "$KEY" -out "$CRT" -days 3650 -nodes \
  -subj "/CN=$IDENTITY" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

# ── 2. Упаковываем в p12 (LibreSSL legacy-MAC — security import примет без -legacy) ──
"$OPENSSL" pkcs12 -export -inkey "$KEY" -in "$CRT" -out "$P12" \
  -passout pass:temp -name "$IDENTITY"

# ── 3. Импорт в login keychain, доступ для codesign ──────────────────────────────
security import "$P12" -k "$KEYCHAIN" -P temp -T /usr/bin/codesign

# ── 4. Доверие для code signing (единственный привилегированный шаг — пароль один раз) ──
echo "[signing] доверяю cert для code signing (понадобится пароль)…"
sudo security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$CRT"

# ── 5. Проверка ──────────────────────────────────────────────────────────────────
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  echo "[signing] готово — «$IDENTITY» доступен для подписи ✅"
else
  echo "[signing] ОШИБКА: cert создан, но не виден в find-identity. Проверь keychain." >&2
  exit 1
fi
