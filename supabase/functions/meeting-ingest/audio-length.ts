// Длина выгруженного аудио, измеренная сервером. Секунды записи в claim присылает клиент;
// перехват права транскрибации другим человеком решается по тому, что сервер измерил сам в
// выгрузке, а не по заявке (meeting-ingest/challenge.ts).
//
// Оба клиента льют AAC в контейнере MP4 (.m4a): рекордер — AVAudioFile/AVAssetWriter и нарезка
// без перекодирования, бот — ffmpeg. Длина считается по содержимому, а не по заголовку ролика:
// заголовок `moov/mvhd` — одно число, которое пишет клиент, и файл с ним одним «длился» бы сколько
// угодно. Поэтому:
//   - берётся единственная звуковая дорожка (hdlr 'soun'): длина = сумма длительностей сэмплов
//     `stts` в шкале её `mdhd`;
//   - каждый сэмпл обязан лежать в присланных байтах: по `stsc` + `stco`/`co64` + `stsz` диапазон
//     каждого чанка — внутри тела какого-то `mdat`, число сэмплов в таблицах сходится, а сумма
//     размеров не больше присланного звука (одни и те же байты не засчитываются дважды);
//   - правдоподобие AAC: кадр не длиннее MAX_FRAME_SEC, звука не меньше MIN_BYTES_PER_SEC;
//   - `mvhd` длину только урезает (нарезка passthrough пишет в нём обрезанный интервал).
// Файл без `mdat`, с чужой дорожкой, двумя звуковыми, фрагментированный — «не измерено».
//
// Всё, что не удалось разобрать однозначно, — null («не измерено»), а не ноль: вызывающий обязан
// отличать «короткая запись» от «не знаем», иначе мусорный файл проходил бы за измеренный.

const HEADER = 8;
const LARGE_HEADER = 16;

/**
 * Нижняя граница звука, байт на секунду. Кадр AAC тишины у обоих клиентов весит 4 байта (замер
 * testdata/: ffmpeg бота и Apple AAC рекордера), при 16 кГц и 1024 сэмплах на кадр это 62 байт/с —
 * самая «лёгкая» честная запись, какую клиенты пишут. Граница ниже неё с запасом.
 */
export const MIN_BYTES_PER_SEC = 40;

/** Самый длинный кадр AAC: 2048 сэмплов (HE-AAC) при 8 кГц — 0.256 с. Длиннее — не AAC. */
export const MAX_FRAME_SEC = 0.26;

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

/** Единственный дочерний бокс нужного типа; нет, повтор или битая вложенность — null. */
function child(dv: DataView, parent: Box, type: string): Box | null {
  const found = readBoxes(dv, parent.bodyStart, parent.end)?.filter((b) => b.type === type);
  return found?.length === 1 ? found[0] : null;
}

/** Шкала и длительность из тела mvhd/mdhd (одинаковая раскладка полей); не прочитать — null. */
function headerTime(dv: DataView, box: Box): { timescale: number; duration: number } | null {
  const len = box.end - box.bodyStart;
  if (len < 1) return null;
  if (dv.getUint8(box.bodyStart) === 1) {
    if (len < 32) return null;
    const raw = dv.getBigUint64(box.bodyStart + 24);
    return { timescale: dv.getUint32(box.bodyStart + 20), duration: raw === 0xffff_ffff_ffff_ffffn ? 0 : Number(raw) };
  }
  if (len < 20) return null;
  const raw = dv.getUint32(box.bodyStart + 16);
  return { timescale: dv.getUint32(box.bodyStart + 12), duration: raw === 0xffff_ffff ? 0 : raw };
}

/** Длительность ролика из mvhd в секундах; нулевая, «неизвестная» или без шкалы — null. */
function mvhdSeconds(dv: DataView, box: Box): number | null {
  const t = headerTime(dv, box);
  return t && t.timescale > 0 && t.duration > 0 ? t.duration / t.timescale : null;
}

/** Читатель полного бокса (после версии и флагов): uint32 подряд, выход за тело — null. */
function entries(dv: DataView, box: Box, fixed: number, width: number): { count: number; at: number } | null {
  const start = box.bodyStart + 4 + fixed * 4;
  if (start + 4 > box.end) return null;
  const count = dv.getUint32(start);
  const at = start + 4;
  return at + count * width * 4 <= box.end ? { count, at } : null;
}

/** Сумма длительностей сэмплов stts и их число; кадр длиннее MAX_FRAME_SEC — null. */
function sttsTotals(dv: DataView, stts: Box, timescale: number): { samples: number; ticks: number } | null {
  const e = entries(dv, stts, 0, 2);
  if (!e) return null;
  let samples = 0;
  let ticks = 0;
  for (let i = 0; i < e.count; i++) {
    const count = dv.getUint32(e.at + i * 8);
    const delta = dv.getUint32(e.at + i * 8 + 4);
    if (count > 0 && delta / timescale > MAX_FRAME_SEC) return null;
    samples += count;
    ticks += count * delta;
  }
  return { samples, ticks };
}

/** Размеры сэмплов из stsz: одинаковый размер или таблица. */
function sampleSizes(dv: DataView, stsz: Box): { count: number; sizeOf: (i: number) => number } | null {
  if (stsz.bodyStart + 12 > stsz.end) return null;
  const constant = dv.getUint32(stsz.bodyStart + 4);
  if (constant !== 0) return { count: dv.getUint32(stsz.bodyStart + 8), sizeOf: () => constant };
  const e = entries(dv, stsz, 1, 1);
  return e ? { count: e.count, sizeOf: (i) => dv.getUint32(e.at + i * 4) } : null;
}

/** Смещения чанков из stco (32 бит) или co64 (64 бит). */
function chunkOffsets(dv: DataView, stbl: Box): number[] | null {
  const stco = child(dv, stbl, "stco");
  const co64 = child(dv, stbl, "co64");
  if ((stco === null) === (co64 === null)) return null;
  const box = (stco ?? co64) as Box;
  const wide = co64 !== null;
  const e = entries(dv, box, 0, wide ? 2 : 1);
  if (!e) return null;
  return Array.from(
    { length: e.count },
    (_, i) => wide ? Number(dv.getBigUint64(e.at + i * 8)) : dv.getUint32(e.at + i * 4),
  );
}

/** Сэмплов в каждом чанке по stsc; таблица не с первого чанка или не по порядку — null. */
function samplesPerChunk(dv: DataView, stsc: Box, chunks: number): number[] | null {
  const e = entries(dv, stsc, 0, 3);
  if (!e || e.count === 0) return null;
  const out: number[] = [];
  for (let i = 0; i < e.count; i++) {
    const first = dv.getUint32(e.at + i * 12);
    const per = dv.getUint32(e.at + i * 12 + 4);
    const next = i + 1 < e.count ? dv.getUint32(e.at + (i + 1) * 12) : chunks + 1;
    if (first !== out.length + 1 || next <= first || next > chunks + 1 || per === 0) return null;
    for (let c = first; c < next; c++) out.push(per);
  }
  return out.length === chunks ? out : null;
}

/**
 * Байт звука дорожки, если каждый её сэмпл лежит внутри тела какого-то mdat, число сэмплов в
 * stsz сходится с `samples`, а сумма размеров не больше присланного звука; иначе — null.
 */
function samplesInMdat(dv: DataView, stbl: Box, samples: number, mdats: Box[]): number | null {
  const stsz = child(dv, stbl, "stsz");
  const stsc = child(dv, stbl, "stsc");
  const offsets = chunkOffsets(dv, stbl);
  if (!stsz || !stsc || !offsets) return null;
  const sizes = sampleSizes(dv, stsz);
  const perChunk = samplesPerChunk(dv, stsc, offsets.length);
  if (!sizes || !perChunk || sizes.count !== samples) return null;
  let sample = 0;
  let bytes = 0;
  for (const [i, start] of offsets.entries()) {
    let chunkBytes = 0;
    for (let k = 0; k < perChunk[i] && sample < samples; k++) chunkBytes += sizes.sizeOf(sample++);
    const inside = mdats.some((m) => start >= m.bodyStart && start + chunkBytes <= m.end);
    if (!inside) return null;
    bytes += chunkBytes;
  }
  const payload = mdats.reduce((n, m) => n + (m.end - m.bodyStart), 0);
  return sample === samples && bytes <= payload ? bytes : null;
}

/** Длина звуковой дорожки по её таблице сэмплов; не сходится с mdat или неправдоподобна — null. */
function trackSeconds(dv: DataView, mdia: Box, mdats: Box[]): number | null {
  const mdhd = child(dv, mdia, "mdhd");
  const minf = child(dv, mdia, "minf");
  const stbl = minf && child(dv, minf, "stbl");
  const stts = stbl && child(dv, stbl, "stts");
  const time = mdhd && headerTime(dv, mdhd);
  if (!stbl || !stts || !time || time.timescale === 0) return null;
  const totals = sttsTotals(dv, stts, time.timescale);
  if (!totals || totals.ticks === 0) return null;
  const bytes = samplesInMdat(dv, stbl, totals.samples, mdats);
  const seconds = totals.ticks / time.timescale;
  return bytes !== null && bytes / seconds >= MIN_BYTES_PER_SEC ? seconds : null;
}

/** mdia дорожки, если она звуковая (hdlr 'soun'); иначе — null. */
function audioMedia(dv: DataView, trak: Box): Box | null {
  const mdia = child(dv, trak, "mdia");
  const hdlr = mdia && child(dv, mdia, "hdlr");
  if (!hdlr || hdlr.end - hdlr.bodyStart < 12) return null;
  const at = hdlr.bodyStart + 8;
  const type = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
  return type === "soun" ? mdia : null;
}

/** Длительность файла MP4/M4A в секундах по содержимому (см. шапку); не удалось — null. */
export function mp4DurationSec(bytes: Uint8Array): number | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readBoxes(dv, 0, bytes.byteLength);
  if (!top || top.some((b) => b.type === "moof")) return null;
  const moovs = top.filter((b) => b.type === "moov");
  const mdats = top.filter((b) => b.type === "mdat");
  if (moovs.length !== 1) return null;
  const mvhd = child(dv, moovs[0], "mvhd");
  const header = mvhd && mvhdSeconds(dv, mvhd);
  const traks = readBoxes(dv, moovs[0].bodyStart, moovs[0].end)?.filter((b) => b.type === "trak") ?? [];
  const audio = traks.map((t) => audioMedia(dv, t)).filter((m): m is Box => m !== null);
  if (!header || audio.length !== 1) return null;
  const content = trackSeconds(dv, audio[0], mdats);
  return content === null ? null : Math.min(content, header);
}

/** Часть дорожки с измеренной длиной: offset — её старт на шкале записи (сек). */
export interface MeasuredPart {
  offset: number;
  durationSec: number | null;
}

/**
 * Сколько секунд шкалы записи покрыто звуком: объединение интервалов [offset, offset+длина] частей
 * обеих дорожек. Не «конец самой поздней части»: offset присылает клиент, и одна короткая часть,
 * поставленная на сутки вперёд, давала бы сутки — то есть тот же самоотчёт, от которого замер и
 * защищает. Объединение не раздувается ни сдвигом, ни повтором части, ни второй дорожкой поверх
 * первой. Рекордер вырезает тишину (SilenceTrimmer), поэтому охват бывает меньше длины встречи —
 * это честная мера того, сколько звука у сервера на руках, и держатель меряется так же
 * (challenge.ts holderSecondsCorrection). Хоть одна часть не измерена или частей нет — null.
 */
export function trackCoverageSec(parts: readonly MeasuredPart[]): number | null {
  if (parts.length === 0) return null;
  const spans: Array<[number, number]> = [];
  for (const p of parts) {
    if (p.durationSec === null) return null;
    spans.push([p.offset, p.offset + p.durationSec]);
  }
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let [from, to] = sorted[0];
  for (const [start, end] of sorted.slice(1)) {
    if (start <= to) {
      to = Math.max(to, end);
      continue;
    }
    covered += to - from;
    [from, to] = [start, end];
  }
  return covered + (to - from);
}
