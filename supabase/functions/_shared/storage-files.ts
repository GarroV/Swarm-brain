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
import { storagePathFromLink, LEGACY_PUBLIC_BUCKET } from "./storage-links.ts";

export const PRIVATE_BUCKET = "swarm_private";

export type StorageOwner =
  | { kind: "entry"; entryId: string }
  | { kind: "feedback" };

export type StoredFile = { path: string; bucket: string };

/** Кладёт объект в приватный бакет. Публичной ссылки на него не существует — только /api/file. */
export async function uploadPrivateFile(
  supabase: SupabaseClient,
  params: { path: string; body: ArrayBuffer | Uint8Array; contentType: string; upsert?: boolean },
): Promise<{ file: StoredFile | null; error: string | null }> {
  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(params.path, params.body, {
      contentType: params.contentType || "application/octet-stream",
      upsert: params.upsert ?? false,
    });
  if (error) return { file: null, error: error.message };
  return { file: { path: params.path, bucket: PRIVATE_BUCKET }, error: null };
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
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
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
