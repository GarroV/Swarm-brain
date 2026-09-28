// Длина выгруженного аудио, измеренная сервером (T160). Секунды записи в claim присылает клиент;
// перехват права транскрибации другим человеком решается по тому, что сервер измерил сам в
// выгрузке, а не по заявке (meeting-ingest/challenge.ts).
//
// Оба клиента льют AAC в контейнере MP4 (.m4a): рекордер — AVAssetWriter и нарезка без
// перекодирования, бот — ffmpeg. Длительность файла лежит в заголовке ролика `moov/mvhd`
// (шкала времени и длительность в её единицах), поэтому читать звук не нужно: обход заголовков
// боксов верхнего уровня, `moov` может стоять и до, и после `mdat`.
//
// Всё, что не удалось разобрать однозначно, — null («не измерено»), а не ноль: вызывающий обязан
// отличать «короткая запись» от «не знаем», иначе мусорный файл проходил бы за измеренный.

const HEADER = 8;
const LARGE_HEADER = 16;

interface Box {
  type: string;
  bodyStart: number;
  end: number;
}

/** Боксы в диапазоне [from, to). Размер, вылезающий за диапазон, — null: файл обрезан или не mp4. */
function readBoxes(dv: DataView, from: number, to: number): Box[] | null {
  const boxes: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < HEADER) return null;
    const size32 = dv.getUint32(at);
    const type = String.fromCharCode(
      dv.getUint8(at + 4),
      dv.getUint8(at + 5),
      dv.getUint8(at + 6),
      dv.getUint8(at + 7),
    );
    let header = HEADER;
    let size: number;
    if (size32 === 1) {
      if (to - at < LARGE_HEADER) return null;
      size = Number(dv.getBigUint64(at + 8));
      header = LARGE_HEADER;
    } else if (size32 === 0) {
      size = to - at; // бокс до конца файла
    } else {
      size = size32;
    }
    if (size < header || at + size > to) return null;
    boxes.push({ type, bodyStart: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/** Длительность из тела mvhd; нулевая, «неизвестная» (все единицы) или без шкалы — null. */
function mvhdDuration(dv: DataView, box: Box): number | null {
  const len = box.end - box.bodyStart;
  if (len < 1) return null;
  const version = dv.getUint8(box.bodyStart);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (len < 32) return null;
    timescale = dv.getUint32(box.bodyStart + 20);
    const raw = dv.getBigUint64(box.bodyStart + 24);
    if (raw === 0xffff_ffff_ffff_ffffn) return null;
    duration = Number(raw);
  } else {
    if (len < 20) return null;
    timescale = dv.getUint32(box.bodyStart + 12);
    duration = dv.getUint32(box.bodyStart + 16);
    if (duration === 0xffff_ffff) return null;
  }
  if (timescale === 0 || duration === 0) return null;
  return duration / timescale;
}

/** Длительность файла MP4/M4A в секундах по `moov/mvhd`; не удалось — null. */
export function mp4DurationSec(bytes: Uint8Array): number | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readBoxes(dv, 0, bytes.byteLength);
  const moov = top?.find((b) => b.type === "moov");
  if (!moov) return null;
  const inner = readBoxes(dv, moov.bodyStart, moov.end);
  const mvhd = inner?.find((b) => b.type === "mvhd");
  return mvhd ? mvhdDuration(dv, mvhd) : null;
}

/** Часть дорожки с измеренной длиной: offset — её старт на шкале записи (сек). */
export interface MeasuredPart {
  offset: number;
  durationSec: number | null;
}

/**
 * До какой секунды записи в выгрузке есть звук: конец самой поздней части по обеим дорожкам.
 * Рекордер вырезает длинные паузы, но каждой части ставит её настоящий старт, поэтому охват
 * близок к длине записи. Хоть одна часть не измерена или частей нет — null.
 */
export function trackSpanSec(parts: readonly MeasuredPart[]): number | null {
  if (parts.length === 0) return null;
  let span = 0;
  for (const p of parts) {
    if (p.durationSec === null) return null;
    span = Math.max(span, p.offset + p.durationSec);
  }
  return span;
}
