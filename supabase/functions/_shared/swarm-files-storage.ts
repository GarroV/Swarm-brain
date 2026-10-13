// Вложения записей и скрины фидбека в `swarm-files` на MUSPELHEIM (решение владельца
// 2026-10-13: «файлы с этого проекта храним на муспельхейме»; сервис и подпись ссылок — как у
// файлов задач, см. files/README.md и _shared/files-token.ts).
//
// Реестр storage_files: bucket = 'swarm-files', path = `<uuid>_<имя>`. Первые 36 знаков — ключ
// объекта на диске (его знает сервис), хвост — ASCII-имя для Content-Disposition: так имя
// живёт в реестре без новой колонки. Права проверяет та же getFileSecure, что и для Storage;
// сервис проверяет только подпись ссылки.
//
// Нет FILES_BASE_URL/FILES_SIGNING_KEY → filesStorage() даёт null, и вызывающий остаётся на
// Supabase Storage (локальный контур, тесты). Сервис не умеет DELETE: убрать байты нельзя.

import { FILE_KEY_RE, type FileClaims, importSigningKey, signFileToken } from "./files-token.ts";
import { mimeForName } from "./task-files.ts";

export const FILES_BUCKET = "swarm-files";

const PUT_TTL_SEC = 15 * 60;
const PUT_TIMEOUT_MS = 60_000;
const KEY_LEN = 36;
const FILES_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9._-]+$/;

/** Человеку: сервис с файлами не ответил. EN + RU, как в соседнем коде. */
export const FILES_UNAVAILABLE = {
  error: "File storage is temporarily unavailable — please try again later",
  error_ru: "Хранилище файлов временно недоступно — попробуйте позже",
} as const;

export type FilesStorage = { base: string; key: () => Promise<CryptoKey> };

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Настроено ли хранилище: нужны и адрес сервиса, и ключ подписи. */
export function filesStorage(
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): FilesStorage | null {
  const base = env("FILES_BASE_URL")?.replace(/\/+$/, "");
  const pkcs8 = env("FILES_SIGNING_KEY");
  if (!base || !pkcs8) return null;
  return {
    base,
    key: () => {
      let k = keyCache.get(pkcs8);
      if (!k) keyCache.set(pkcs8, k = importSigningKey(pkcs8));
      return k;
    },
  };
}

/** Путь реестра принадлежит swarm-files (а не Storage): форма `<uuid>_<имя>`. */
export function isFilesPath(path: string): boolean {
  return FILES_PATH_RE.test(path);
}

/** Бакет для строки реестра по пути. */
export function bucketForPath(path: string, fallback: string): string {
  return isFilesPath(path) ? FILES_BUCKET : fallback;
}

export function buildFilesPath(safeName: string, id: string = crypto.randomUUID()): string {
  return `${id}_${safeName}`;
}

function splitFilesPath(path: string): { key: string; name: string } {
  return { key: path.slice(0, KEY_LEN), name: path.slice(KEY_LEN + 1) };
}

function objectUrl(base: string, key: string, token: string): string {
  return `${base}/f/${key}?t=${encodeURIComponent(token)}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Кладёт байты в swarm-files по подписанной put-ссылке (лимит = размер). Любой сбой — ошибка:
 * вызывающий не пишет строку реестра и сообщает человеку (FILES_UNAVAILABLE).
 */
export async function putFilesObject(
  store: FilesStorage,
  path: string,
  body: ArrayBuffer | Uint8Array,
  fetchFn: typeof fetch = fetch,
): Promise<{ error: string | null }> {
  const { key } = splitFilesPath(path);
  if (!FILE_KEY_RE.test(key)) return { error: `invalid files key: ${path}` };
  if (body.byteLength === 0) return { error: "empty file" };
  const claims: FileClaims = { k: key, op: "put", exp: nowSec() + PUT_TTL_SEC, max: body.byteLength };
  try {
    const token = await signFileToken(await store.key(), claims);
    const res = await fetchFn(objectUrl(store.base, key, token), {
      method: "PUT",
      body: body as BodyInit,
      signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `swarm-files PUT ${res.status}` };
    return { error: null };
  } catch (e) {
    return { error: `swarm-files PUT failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Подписанная get-ссылка на объект (имя и тип — для Content-Disposition/Content-Type). */
export async function signedFilesGetUrl(
  store: FilesStorage,
  path: string,
  ttlSec: number,
): Promise<string> {
  const { key, name } = splitFilesPath(path);
  const token = await signFileToken(await store.key(), {
    k: key,
    op: "get",
    exp: nowSec() + ttlSec,
    n: name,
    m: mimeForName(name),
  });
  return objectUrl(store.base, key, token);
}
