// Правила файлов к задаче (решение владельца 2026-09-30, docs/decisions/2026-09-30-task-files-on-muspelheim.md):
// лимиты, какие файлы принимаем, кто может убрать. Чистые функции — без БД и сети, чтобы
// проверить их тестом. Роуты — `swarm-api/task-files.ts`, байты — сервис `files/` на MUSPELHEIM.

/** Лимит по умолчанию: «честно пишем что можно загрузить, допустим, 50мб файл». */
export const DEFAULT_MAX_MB = 50;
export const DEFAULT_MAX_COUNT = 10;
export const NAME_MAX = 200;

export type TaskFileLimits = {
  maxBytes: number;
  maxFiles: number;
  accept: string[];
};

/**
 * Что принимаем — по расширению: документы, таблицы, презентации, картинки, архивы. Видео и
 * исполняемых нет. Список же уходит в веб (`accept` у поля выбора файла и подпись под кнопкой).
 */
export const ACCEPT_EXT = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "txt",
  "csv",
  "md",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "zip",
] as const;

/** Показываются в браузере на месте (остальное — только скачиванием). Без SVG и HTML: в них скрипты. */
const INLINE_EXT = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"]);

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  zip: "application/zip",
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Лимиты из переменных `TASK_FILES_MAX_MB` / `TASK_FILES_MAX_COUNT`; мусор — значение по умолчанию. */
export function taskFileLimits(
  env: (name: string) => string | undefined,
): TaskFileLimits {
  return {
    maxBytes: positiveInt(env("TASK_FILES_MAX_MB"), DEFAULT_MAX_MB) * 1024 *
      1024,
    maxFiles: positiveInt(env("TASK_FILES_MAX_COUNT"), DEFAULT_MAX_COUNT),
    accept: [...ACCEPT_EXT],
  };
}

export function fileExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** Имя для показа и скачивания: без путей и управляющих символов, не длиннее NAME_MAX. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // deno-lint-ignore no-control-regex
  const s = base.replace(/[\u0000-\u001f\u007f"]/g, "").replace(/\s+/g, " ")
    .trim();
  if (s.length <= NAME_MAX) return s;
  const ext = fileExt(s);
  return ext
    ? `${s.slice(0, NAME_MAX - ext.length - 1)}.${ext}`
    : s.slice(0, NAME_MAX);
}

export type NewFileInput = { name: string; size: number; mime: string };
export type NewFileError = "name" | "type" | "empty" | "too_big" | "too_many";

/** Проверка запроса на загрузку. `existing` — сколько живых файлов у задачи уже есть. */
export function checkNewFile(
  body: unknown,
  limits: TaskFileLimits,
  existing: number,
): NewFileInput | { error: NewFileError } {
  const b = (body ?? {}) as { name?: unknown; size?: unknown };
  const name = typeof b.name === "string" ? cleanFileName(b.name) : "";
  if (!name) return { error: "name" };
  const ext = fileExt(name);
  if (!(ACCEPT_EXT as readonly string[]).includes(ext)) {
    return { error: "type" };
  }
  const size = typeof b.size === "number" && Number.isInteger(b.size)
    ? b.size
    : -1;
  if (size <= 0) return { error: "empty" };
  if (size > limits.maxBytes) return { error: "too_big" };
  if (existing >= limits.maxFiles) return { error: "too_many" };
  // Тип выводим из расширения сами: браузерному не верим, он уходит в Content-Type ответа.
  return { name, size, mime: MIME[ext] ?? "application/octet-stream" };
}

/** Открывать в браузере или только скачивать. */
export function isInline(name: string): boolean {
  return INLINE_EXT.has(fileExt(name));
}

/** Content-Disposition с именем в UTF-8 (RFC 6266) и ASCII-запасом для старых клиентов. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${
    inline ? "inline" : "attachment"
  }; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export type FileRemoveCtx = { uploadedBy: number; taskOwnerId: number | null };

/** Убрать файл может тот, кто его прикрепил, владелец задачи или админ. */
export function canRemoveTaskFile(
  f: FileRemoveCtx,
  viewerId: number,
  isAdmin: boolean,
): boolean {
  return isAdmin || f.uploadedBy === viewerId ||
    (f.taskOwnerId !== null && f.taskOwnerId === viewerId);
}
