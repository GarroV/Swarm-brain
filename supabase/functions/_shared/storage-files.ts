// Загрузка файлов в приватный бакет и их регистрация в реестре storage_files.
//
// Почему отдельный модуль: точек загрузки четыре (веб-аплоад, скрин фидбека, бот, MCP), и до
// сих пор каждая сама выбирала бакет и сама решала, что вернуть наружу. Из-за этого файл
// команды оказывался в ПУБЛИЧНОМ бакете с предсказуемым путём — внутренний документ качался
// анонимно. Теперь путь один: upload в swarm_private → строка реестра (чей файл) → ссылка
// наружу только через /api/file/<path> (см. storage-links.ts).
//
// Реестр пишется ПОСЛЕ создания записи-владельца: entry_id — внешний ключ, и до insert его нет.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LEGACY_PUBLIC_BUCKET, storagePathFromLink } from "./storage-links.ts";

export const PRIVATE_BUCKET = "swarm_private";

export type StorageOwner =
  | { kind: "entry"; entryId: string }
  | { kind: "feedback" };

export type StoredFile = { path: string; bucket: string };

/**
 * Кладёт объект в приватный бакет. Публичной ссылки на него не существует — только /api/file.
 *
 * Перезапись запрещена всегда (`upsert: false`): занятый ключ — ошибка, а не замена. Иначе
 * загрузка по совпавшему ключу молча подменяла бы чужой объект, а откат такой загрузки удалял бы
 * его. Новые загрузки строят ключ через buildUploadKey (uploadNewPrivateFile).
 */
export async function uploadPrivateFile(
  supabase: SupabaseClient,
  params: { path: string; body: ArrayBuffer | Uint8Array; contentType: string },
): Promise<{ file: StoredFile | null; error: string | null }> {
  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(params.path, params.body, {
      contentType: params.contentType || "application/octet-stream",
      upsert: false,
    });
  if (error) return { file: null, error: error.message };
  return { file: { path: params.path, bucket: PRIVATE_BUCKET }, error: null };
}

// ── Ключи загрузки ────────────────────────────────────────────────────────────
//
// Ключ = <папка>/<воркспейс владельца>/<дата>_<uuid>_<имя>. Воркспейс в пути разводит файлы
// разных воркспейсов, полный uuid делает ключ непредсказуемым и уникальным. Старые ключи
// (uploads/<дата>_<имя> и т.п.) остаются читаемыми: отдача ищет путь в реестре storage_files
// и от формы ключа не зависит.

/** Служебная область для скринов фидбека: они admin-only и воркспейсу не принадлежат. */
export const FEEDBACK_SCOPE = "_feedback";

// Слаг воркспейса — a-z, 0-9, «-» (см. POST /admin/workspaces); «_» допускаем для FEEDBACK_SCOPE.
const SCOPE_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/i;
const FOLDER_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_TAIL_RE = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${UUID_PART}_[A-Za-z0-9._-]+$`, "i");

export function buildUploadKey(params: {
  folder: string;
  scope: string;
  fileName: string;
  now?: Date;
  id?: string;
}): string {
  if (!FOLDER_RE.test(params.folder)) throw new Error(`invalid upload folder: ${params.folder}`);
  if (!SCOPE_RE.test(params.scope)) throw new Error(`invalid upload scope: ${params.scope}`);
  const id = params.id ?? crypto.randomUUID();
  const date = (params.now ?? new Date()).toISOString().slice(0, 10);
  return `${params.folder}/${params.scope}/${date}_${id}_${safeStorageName(params.fileName)}`;
}

/** Ключ построен buildUploadKey для этого воркспейса (папка/воркспейс/дата_uuid_имя). */
export function isOwnUploadKey(path: string, scope: string): boolean {
  if (!SCOPE_RE.test(scope)) return false;
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  const [folder, keyScope, tail] = parts;
  return FOLDER_RE.test(folder) && keyScope === scope && KEY_TAIL_RE.test(tail);
}

/** Файл, созданный этим запросом: только его и разрешено откатить (discardOwnUpload). */
export type UploadedFile = StoredFile & { scope: string };

/** Новая загрузка: уникальный ключ в воркспейсе владельца, без перезаписи. */
export async function uploadNewPrivateFile(
  supabase: SupabaseClient,
  params: {
    folder: string;
    scope: string;
    fileName: string;
    body: ArrayBuffer | Uint8Array;
    contentType: string;
  },
): Promise<{ file: UploadedFile | null; error: string | null }> {
  let path: string;
  try {
    path = buildUploadKey(params);
  } catch (e) {
    return { file: null, error: e instanceof Error ? e.message : String(e) };
  }
  const { file, error } = await uploadPrivateFile(supabase, {
    path,
    body: params.body,
    contentType: params.contentType,
  });
  if (error || !file) return { file: null, error: error ?? "upload failed" };
  return { file: { ...file, scope: params.scope }, error: null };
}

/**
 * Откат загрузки: убирает объект, только если это ключ нового вида внутри своего воркспейса.
 * Вызывать с тем UploadedFile, что вернул uploadNewPrivateFile в этом же запросе.
 */
export async function discardOwnUpload(
  supabase: SupabaseClient,
  file: UploadedFile,
): Promise<{ removed: boolean; error: string | null }> {
  if (!isOwnUploadKey(file.path, file.scope)) {
    return { removed: false, error: `not an own upload key: ${file.path}` };
  }
  const { error } = await supabase.storage.from(file.bucket).remove([file.path]);
  if (error) return { removed: false, error: error.message };
  return { removed: true, error: null };
}

/**
 * Регистрирует файл в реестре: без строки реестра эндпоинт /file отдаст 404, то есть файл
 * будет залит и недоступен. Ошибку возвращаем, а не глотаем, — вызывающий обязан решить,
 * что делать (обычно: убрать объект и сообщить об ошибке, а не делать вид, что всё хорошо).
 */
export async function registerStorageFile(
  supabase: SupabaseClient,
  params: { path: string; bucket?: string; owner: StorageOwner },
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("storage_files").insert({
    path: params.path,
    bucket: params.bucket ?? PRIVATE_BUCKET,
    owner_kind: params.owner.kind,
    entry_id: params.owner.kind === "entry" ? params.owner.entryId : null,
  });
  return { error: error ? error.message : null };
}

// Сколько живёт ссылка, которую качает внешний клиент (Telegram). Минуты хватает: Telegram
// забирает файл сразу, а короткий срок означает, что утёкшая ссылка бесполезна.
export const EXTERNAL_TTL_SEC = 60;

/**
 * Ссылка, по которой файл может забрать ВНЕШНИЙ качальщик без нашей сессии (Telegram).
 *
 * Наш файл → короткоживущий signed URL. Внешняя ссылка (Google Drive и прочее) → как есть:
 * это не наш объект, подписывать нечего. Не найден/не удалось подписать → null, и вызывающий
 * обязан сказать об этом человеку, а не отправлять пустоту.
 */
export async function externalFileUrl(
  supabase: SupabaseClient,
  link: unknown,
  ttlSec: number = EXTERNAL_TTL_SEC,
): Promise<string | null> {
  if (typeof link !== "string" || !link.trim()) return null;
  const path = storagePathFromLink(link);
  if (!path) return link; // не наш объект — отдаём как есть

  const { data: reg } = await supabase
    .from("storage_files")
    .select("bucket")
    .eq("path", path)
    .maybeSingle();
  const bucket = (reg as { bucket?: string } | null)?.bucket ?? LEGACY_PUBLIC_BUCKET;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Имя объекта в Storage обязано быть ASCII: ключ с кириллицей отвергается («Invalid key»),
// то есть файл с русским названием просто не загружается. Пробел и скобки при этом
// допустимы, но заменяются тоже — так путь остаётся читаемым в логах и ссылках.
export const RU_TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/**
 * Build an ASCII-safe Supabase Storage object key. Storage keys reject
 * non-ASCII (Cyrillic etc.) — transliterate, strip the rest, keep it readable.
 */
export function safeStorageName(fileName: string): string {
  const translit = [...fileName].map((ch) => {
    const lower = ch.toLowerCase();
    const mapped = RU_TRANSLIT[lower];
    if (mapped === undefined) return ch;
    return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join("");
  const ascii = translit.replace(/[^a-zA-Z0-9.\-_]/g, "_").replace(/_+/g, "_");
  return ascii.replace(/^_+|_+$/g, "") || "file";
}
