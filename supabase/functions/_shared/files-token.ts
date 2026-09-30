// Короткоживущая ссылка на файл в хранилище `swarm-files` на MUSPELHEIM (решение владельца
// 2026-09-30, docs/decisions/2026-09-30-task-files-on-muspelheim.md).
//
// Сервис на сервере базы не знает и прав не проверяет: права проверяет `swarm-api`
// (`canViewTask`) и выдаёт ссылку, подписанную закрытым ключом Ed25519. Сервис сверяет подпись
// открытым ключом. Поэтому на сервере лежит только открытый ключ: утечка с него не позволяет
// выпустить ни одной ссылки. Этот модуль общий — его импортируют и функция, и сервис (`files/`).
//
// Формат: `<base64url(JSON)>.<base64url(подпись)>`, подписаны байты первой части.

export type FileOp = "put" | "get";

export type FileClaims = {
  /** Ключ объекта на диске: uuid, без имени файла (имя приходит отдельно). */
  k: string;
  op: FileOp;
  /** Unix-секунды, после которых ссылка недействительна. */
  exp: number;
  /** Только для put: сколько байт сервис примет, не больше. */
  max?: number;
  /** Только для get: имя для Content-Disposition и тип для Content-Type. */
  n?: string;
  m?: string;
};

export const FILE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));
}

/** Закрытый ключ из секрета `FILES_SIGNING_KEY` (PKCS8, base64). */
export function importSigningKey(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    fromB64(pkcs8B64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

/** Открытый ключ из `FILES_PUBLIC_KEY` на сервере (raw, 32 байта, base64). */
export function importVerifyKey(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromB64(rawB64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

export async function signFileToken(
  key: CryptoKey,
  claims: FileClaims,
): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", key, enc.encode(body)),
  );
  return `${body}.${b64url(sig)}`;
}

export type VerifyResult = { ok: true; claims: FileClaims } | {
  ok: false;
  reason: string;
};

/**
 * Проверить ссылку для операции `op` над объектом `k`. Любая неясность — отказ: битый формат,
 * чужая подпись, истёкший срок, другая операция или другой объект.
 */
export async function verifyFileToken(
  key: CryptoKey,
  token: string,
  op: FileOp,
  k: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  let sigOk = false;
  try {
    sigOk = await crypto.subtle.verify(
      "Ed25519",
      key,
      fromB64url(parts[1]),
      enc.encode(parts[0]),
    );
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!sigOk) return { ok: false, reason: "bad signature" };
  let claims: FileClaims;
  try {
    claims = JSON.parse(dec.decode(fromB64url(parts[0])));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.exp !== "number" || claims.exp < nowSec) {
    return { ok: false, reason: "expired" };
  }
  if (claims.op !== op) return { ok: false, reason: "wrong op" };
  if (claims.k !== k || !FILE_KEY_RE.test(k)) {
    return { ok: false, reason: "wrong object" };
  }
  if (op === "put" && !(typeof claims.max === "number" && claims.max > 0)) {
    return { ok: false, reason: "no size limit" };
  }
  return { ok: true, claims };
}
