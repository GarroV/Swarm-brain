// Охрана частей аудио перед Whisper (#150): огрызок короче минимума модели и «отравленная» часть.
// Чистая логика без сети — ядро: от неё зависит, что часть не уйдёт молча без причины.

// Whisper отвечает ошибкой на файле короче ~0.1 с (хвостовой чанк, дописанный при остановке записи).
export const MIN_WHISPER_PART_SECONDS = 0.1;
// Попыток на одну часть, прежде чем считать её «отравленной» и пропустить (poison-pill guard).
export const MAX_PART_ATTEMPTS = 4;
// Причина в process_state — не больше этого (state пишется в jsonb на каждом шаге).
const MAX_REASON_CHARS = 300;

/** Поля части, которые охрана читает и пишет. */
export interface GuardedPart {
  path: string;
  done: boolean;
  attempts: number;
  /** Причина пропуска: часть не транскрибируется и не блокирует встречу. */
  skipped?: string;
  /** Текст последней ошибки транскрибации (очищается успехом). */
  error?: string;
}

const BOX_HEADER = 8;
const MVHD_BODY_BYTES = 32;

async function readBytes(blob: Blob, from: number, len: number): Promise<DataView | null> {
  if (from >= blob.size) return null;
  return new DataView(await blob.slice(from, from + len).arrayBuffer());
}
const tag = (v: DataView, at: number): string => String.fromCharCode(...new Uint8Array(v.buffer, at, 4));

// Размер и тип коробки ISO BMFF по смещению; size 1 — 64-битный, 0 — до конца файла.
async function boxAt(blob: Blob, pos: number): Promise<{ type: string; size: number; header: number } | null> {
  const h = await readBytes(blob, pos, 16 > blob.size - pos ? blob.size - pos : 16);
  if (!h || h.byteLength < BOX_HEADER) return null;
  const size32 = h.getUint32(0);
  const type = tag(h, 4);
  if (size32 === 1) return h.byteLength >= 16 ? { type, size: Number(h.getBigUint64(8)), header: 16 } : null;
  return { type, size: size32 === 0 ? blob.size - pos : size32, header: BOX_HEADER };
}

/**
 * Длительность m4a/mp4 в секундах по mvhd (moov → mvhd), без чтения всего файла: идём по заголовкам
 * коробок. null — не удалось разобрать (чужой формат, битый файл): решает не охрана, а Whisper.
 */
export async function blobDurationSeconds(blob: Blob): Promise<number | null> {
  let pos = 0;
  for (let i = 0; i < 64 && pos < blob.size; i++) {
    const box = await boxAt(blob, pos);
    if (!box || box.size < box.header) return null;
    if (box.type === "moov") {
      let inner = pos + box.header;
      const end = Math.min(pos + box.size, blob.size);
      for (let j = 0; j < 64 && inner < end; j++) {
        const child = await boxAt(blob, inner);
        if (!child || child.size < child.header) return null;
        if (child.type === "mvhd") return await mvhdSeconds(blob, inner + child.header);
        inner += child.size;
      }
      return null;
    }
    pos += box.size;
  }
  return null;
}

async function mvhdSeconds(blob: Blob, bodyAt: number): Promise<number | null> {
  const v = await readBytes(blob, bodyAt, MVHD_BODY_BYTES);
  if (!v) return null;
  const version = v.getUint8(0);
  if (v.byteLength < (version === 1 ? 32 : 20)) return null;
  const timescale = version === 1 ? v.getUint32(20) : v.getUint32(12);
  const duration = version === 1 ? Number(v.getBigUint64(24)) : v.getUint32(16);
  return timescale > 0 ? duration / timescale : null;
}

/** Причина пропуска части короче минимума Whisper; null — часть годная (или длина неизвестна). */
export function tooShortReason(durationSeconds: number | null): string | null {
  if (durationSeconds === null || durationSeconds >= MIN_WHISPER_PART_SECONDS) return null;
  return `too_short: ${durationSeconds.toFixed(3)}s < ${MIN_WHISPER_PART_SECONDS}s (min for Whisper)`;
}

/** Помечает часть пропущенной сразу: ни одной попытки Whisper, существующие фильтры её не берут. */
export function markSkipped(p: GuardedPart, reason: string): void {
  p.done = false;
  p.attempts = MAX_PART_ATTEMPTS;
  p.skipped = reason;
}

/**
 * Учёт провала транскрибации: попытка списана, причина последней ошибки остаётся в state (логи
 * Edge Functions живут ~24 ч). На последней попытке часть пропущена poison-guard'ом — вернётся
 * строка для лога (одна на часть); иначе null.
 */
export function registerPartFailure(p: GuardedPart, error: unknown): string | null {
  p.attempts = (p.attempts ?? 0) + 1;
  p.error = String(error).slice(0, MAX_REASON_CHARS);
  console.error(`meeting-processor: part ${p.path} attempt ${p.attempts} failed:`, error);
  if (p.attempts < MAX_PART_ATTEMPTS) return null;
  p.skipped = `poison: ${p.attempts} attempts failed, last error: ${p.error}`;
  const line = `meeting-processor: part ${p.path} пропущена poison-guard после ${p.attempts} попыток — ${p.error}`;
  console.warn(line);
  return line;
}

/** Часть ещё ждёт транскрибации. */
export function isPartPending(p: GuardedPart): boolean {
  return !p.done && p.attempts < MAX_PART_ATTEMPTS;
}

/** Регистрация части при выгрузке: короче минимума Whisper — пропускаем сразу (true), строка в лог. */
export async function skipIfTooShort(p: GuardedPart, blob: Blob): Promise<boolean> {
  const reason = tooShortReason(await blobDurationSeconds(blob));
  if (!reason) return false;
  markSkipped(p, reason);
  console.warn(`meeting-processor: part ${p.path} пропущена при регистрации — ${reason}`);
  return true;
}
