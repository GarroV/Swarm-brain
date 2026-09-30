// Файлы к задаче в вебе (#638): размер для людей, вид файла, проверка до загрузки. Чистые функции —
// правило «что можно загрузить» сервер держит сам (`_shared/task-files.ts`), а здесь его зеркало,
// чтобы отказ прозвучал сразу при выборе файла, а не после минуты загрузки. Лимиты не зашиты:
// приходят с сервера вместе со списком.

export type TaskFileLimits = { maxBytes: number; maxFiles: number; accept: string[] };

export type TaskFile = {
  id: string;
  name: string;
  size: number;
  mime: string;
  inline: boolean;
  uploaded_by: number;
  uploaded_by_name: string | null;
  created_at: string;
};

export type FileKind = "pdf" | "image" | "sheet" | "slides" | "doc" | "archive" | "other";

const KIND: Record<string, FileKind> = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet",
  ppt: "slides", pptx: "slides", odp: "slides",
  doc: "doc", docx: "doc", odt: "doc", rtf: "doc", txt: "doc", md: "doc",
  zip: "archive",
};

export function fileExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function fileKind(name: string): FileKind {
  return KIND[fileExt(name)] ?? "other";
}

/** «640 КБ», «2,4 МБ» — одна цифра после запятой, и только когда она что-то значит. */
export function formatSize(bytes: number, en = false): string {
  const units = en ? ["B", "KB", "MB", "GB"] : ["Б", "КБ", "МБ", "ГБ"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 10 ? 0 : 1;
  const num = v.toLocaleString(en ? "en-US" : "ru-RU", { maximumFractionDigits: digits });
  return `${num} ${units[i]}`;
}

export type RejectReason = "type" | "empty" | "too_big" | "too_many";

/**
 * Какие из выбранных файлов пойдут в загрузку, а какие нет и почему. `existing` — сколько файлов
 * у задачи уже есть (вместе с теми, что грузятся прямо сейчас).
 */
export function splitPicked<T extends { name: string; size: number }>(
  picked: T[],
  limits: TaskFileLimits,
  existing: number,
): { ok: T[]; rejected: { file: T; reason: RejectReason }[] } {
  const ok: T[] = [];
  const rejected: { file: T; reason: RejectReason }[] = [];
  for (const file of picked) {
    const reason: RejectReason | null = !limits.accept.includes(fileExt(file.name))
      ? "type"
      : file.size <= 0
      ? "empty"
      : file.size > limits.maxBytes
      ? "too_big"
      : existing + ok.length >= limits.maxFiles
      ? "too_many"
      : null;
    if (reason) rejected.push({ file, reason });
    else ok.push(file);
  }
  return { ok, rejected };
}
