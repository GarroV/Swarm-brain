// Ссылки на файлы хранилища: единственное место, где строится адрес файла для внешнего мира.
//
// Файлы команды больше не отдаются публичным URL бакета (утечка swarm_drive: публичный бакет +
// предсказуемые пути = внутренний документ скачивался анонимно). Наружу уходит СТАБИЛЬНАЯ ссылка
// на наш эндпоинт `GET /file/*` (swarm-api), который проверяет доступ по реестру storage_files
// и отдаёт 302 на короткоживущий signed URL.
//
// Почему нормализация, а не только «писать правильно при загрузке»: в metadata записей уже лежат
// старые публичные URL, и переписать их в БД — отдельный шаг миграции. Пока он не прошёл (и на
// случай, если где-то останется старое значение), ссылка чинится НА ОТДАЧЕ — клиент всегда видит
// /api/file/<path>, независимо от того, что записано в базе.
//
// ВАЖНО про бота: Telegram качает файл сам, без нашей сессии, поэтому боту эта ссылка не годится —
// он генерит signed URL напрямую. См. swarm-bot/lib/storage.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Бакет, куда файлы клались до перехода на приватный: строки реестра для них могут
// отсутствовать (они старше реестра), поэтому он же и запасной вариант при удалении.
export const LEGACY_PUBLIC_BUCKET = "swarm_drive";

// Префикс веб-маршрута. Веб ходит в API через same-origin прокси Cloudflare Pages (/api/* →
// swarm-api), поэтому ссылка относительная: сессионная cookie доезжает, CORS не участвует.
export const API_FILE_PREFIX = "/api/file/";

// Путь объекта внутри бакета в URL самого Supabase Storage: /storage/v1/object/<вид>/<бакет>/<путь>.
// Вид: public (старые публичные), sign (подписанные), authenticated (через ключ).
const STORAGE_OBJECT_RE =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Битая процентная последовательность — оставляем как есть: лучше сырое имя,
    // чем исключение на отдаче списка записей.
    return value;
  }
}

/**
 * Достаёт путь объекта в бакете из чего угодно, что может лежать в metadata.file_url:
 * публичного URL, signed URL, нашей ссылки /api/file/… или уже готового пути.
 *
 * Возвращает null, если это ссылка не на наш файл (чужой домен, произвольный URL) — такое
 * значение НЕ превращаем в путь: выдать чужой адрес за файл хранилища хуже, чем не отдать ничего.
 */
export function storagePathFromLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    // Наша же ссылка, но абсолютная (например, из MCP-ответа).
    if (parsed.pathname.startsWith(API_FILE_PREFIX)) {
      return safeDecode(parsed.pathname.slice(API_FILE_PREFIX.length)) || null;
    }
    const m = parsed.pathname.match(STORAGE_OBJECT_RE);
    // query (?token=…) в pathname не попадает — signed URL чистится сам собой.
    return m ? safeDecode(m[1]) || null : null;
  }

  if (raw.startsWith(API_FILE_PREFIX)) {
    return safeDecode(raw.slice(API_FILE_PREFIX.length)) || null;
  }

  // Не URL — считаем путём в бакете.
  return raw.replace(/^\/+/, "") || null;
}

/** Ссылка для веба: относительная, same-origin через прокси /api. */
export function webFileUrl(path: string): string {
  return API_FILE_PREFIX + encodePath(path);
}

/** Ссылка для получателей без нашей страницы (MCP-ответ в Claude Desktop, письма). */
export function absoluteFileUrl(path: string, baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + webFileUrl(path);
}

// Кодируем посегментно: разделители пути остаются слэшами, а пробел, кириллица, '?' и '#'
// внутри имени файла — кодируются, иначе ссылка рвётся на query/fragment.
function encodePath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export type NormalizeOptions = {
  /** Задан — ссылка получается абсолютной (для получателей вне нашей страницы). */
  baseUrl?: string;
};

/**
 * Приводит значение metadata.file_url к ссылке через наш эндпоинт.
 * Нераспознанное значение → null: ссылку не выдумываем и чужой URL не пропускаем как файл.
 */
export function normalizeFileLink(value: unknown, opts: NormalizeOptions = {}): string | null {
  const path = storagePathFromLink(value);
  if (!path) return null;
  return opts.baseUrl ? absoluteFileUrl(path, opts.baseUrl) : webFileUrl(path);
}

/**
 * Строка записи с нормализованной metadata.file_url — то, что применяем ПЕРЕД отдачей наружу.
 *
 * Работает только с нашими файлами: внешняя ссылка (Google Drive и прочее) — легитимное
 * содержимое записи и остаётся нетронутой. Исходный объект не мутируется: строка приходит
 * из ответа supabase-js и может использоваться дальше по коду.
 *
 * ВАЖНО: применять на ОТДАЧЕ, а не внутри логики. Серверные потребители (удаление объекта,
 * отправка файла ботом) читают metadata из базы сами и ждут там путь/URL хранилища, а не
 * наш маршрут.
 */
export function withNormalizedFileLink<T extends Record<string, unknown>>(
  row: T,
  opts: NormalizeOptions = {},
): T {
  const meta = row?.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return row;
  const current = (meta as Record<string, unknown>).file_url;
  if (typeof current !== "string") return row;

  const normalized = normalizeFileLink(current, opts);
  if (!normalized || normalized === current) return row;

  return { ...row, metadata: { ...(meta as Record<string, unknown>), file_url: normalized } } as T;
}

export type RemoveResult = {
  status: "removed" | "no-file" | "failed";
  path?: string;
  bucket?: string;
  error?: string;
};

/**
 * Удаляет объект записи из хранилища и снимает его строку реестра.
 *
 * Единственное место, где это делается: раньше каждый вызывающий сам резал путь строкой
 * («split("/swarm_drive/")», «split("/object/public/swarm_drive/")»), и оба варианта
 * сломались бы о второй бакет и о percent-encoded имя — remove() уходил по несуществующему
 * ключу, ошибки не возвращал, а человеку сообщалось «удалено вместе с файлом».
 *
 * Ошибку НЕ проглатывает: вызывающий обязан решить, что сказать. Строку реестра снимаем
 * только после фактического удаления объекта — иначе файл остаётся в хранилище без
 * владельца, то есть навсегда и без следов.
 */
export async function removeStorageObject(
  supabase: SupabaseClient,
  link: unknown,
): Promise<RemoveResult> {
  const path = storagePathFromLink(link);
  if (!path) return { status: "no-file" };

  const { data: reg } = await supabase
    .from("storage_files")
    .select("bucket")
    .eq("path", path)
    .maybeSingle();
  const bucket = (reg as { bucket?: string } | null)?.bucket ?? LEGACY_PUBLIC_BUCKET;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) return { status: "failed", error: error.message, path, bucket };

  await supabase.from("storage_files").delete().eq("path", path);
  return { status: "removed", path, bucket };
}
