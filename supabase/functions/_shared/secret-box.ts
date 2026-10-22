// Шифрование секретов пространств: AES-256-GCM на Web Crypto, без зависимостей.
//
// Ключ шифрования — секрет сервера WORKSPACE_SECRETS_KEY (base64 от 32 байт), в базе его нет:
// утечка таблицы `workspace_secrets` сама по себе ключи не раскрывает. AAD (`<group_id>:<kind>`)
// привязывает шифротекст к пространству — строка, перенесённая в другое пространство или
// подменённая, не расшифруется. Нет или кривой ключ шифрования — бросаем понятную ошибку,
// а не возвращаем null: тихий пропуск выглядел бы как «секрета нет».

export type SealedSecret = { ciphertext: string; iv: string };

const KEY_ENV = "WORKSPACE_SECRETS_KEY";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get(KEY_ENV);
  if (!raw) return Promise.reject(new Error(`${KEY_ENV} не задан: секреты пространств не зашифровать и не прочитать`));
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(raw.trim());
  } catch {
    return Promise.reject(new Error(`${KEY_ENV} не base64`));
  }
  if (bytes.length !== KEY_BYTES) {
    return Promise.reject(new Error(`${KEY_ENV} должен быть base64 от ${KEY_BYTES} байт (сейчас ${bytes.length})`));
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Задан ли годный ключ шифрования (base64 от 32 байт). Без него секреты пространств недоступны. */
export function secretsKeyConfigured(): boolean {
  const raw = Deno.env.get(KEY_ENV);
  if (!raw) return false;
  try {
    return fromBase64(raw.trim()).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/** Зашифровать `plain`; `aad` = `<group_id>:<kind>`. */
export async function sealSecret(plain: string, aad: string): Promise<SealedSecret> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: toBase64(new Uint8Array(enc)), iv: toBase64(iv) };
}

/** Расшифровать. Подмена шифротекста/iv или чужой `aad` — ошибка, не пустое значение. */
export async function openSecret(sealed: SealedSecret, aad: string): Promise<string> {
  const key = await importKey();
  try {
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: new TextEncoder().encode(aad) },
      key,
      fromBase64(sealed.ciphertext),
    );
    return new TextDecoder().decode(dec);
  } catch {
    throw new Error("секрет не расшифровывается: шифротекст повреждён, подменён или ключ шифрования сменился");
  }
}
