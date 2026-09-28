// Сборщик .m4a для тестов и смоуков замера длины (audio-length.ts). Не звук, а его форма: файл
// устроен так же, как у клиентов (ffmpeg бота, AVAudioFile/AVAssetWriter рекордера) — ftyp, mdat с
// кадрами AAC нужного объёма и moov с одной звуковой дорожкой (mdhd, hdlr 'soun', таблицы сэмплов
// stts/stsz/stsc/stco). Поддельный Whisper звук не слушает, серверу для замера нужна только форма.
//
// Поля `Overrides` ломают файл по одному признаку — ими тесты проверяют, что замер такой файл не
// принимает. В продуктовый код не импортируется.

const SAMPLE_RATE = 48_000;
const FRAME = 1024; // сэмплов на кадр AAC-LC — столько пишет ffmpeg в stts
const FRAMES_PER_CHUNK = 44; // ≈ столько кадров в чанке кладёт ffmpeg

export interface Overrides {
  /** Длительность в mvhd (сек); по умолчанию — честная. */
  mvhdSec?: number;
  /** Байт на кадр; по умолчанию 16 (≈ 750 байт/с — выше тишины AAC у обоих клиентов). */
  frameBytes?: number;
  /** Длительность кадра в единицах шкалы; по умолчанию 1024. */
  frameDelta?: number;
  /** Сколько кадров таблица сэмплов объявляет сверх настоящих (0 — сколько есть). */
  extraDeclaredFrames?: number;
  /** Тип дорожки в hdlr; по умолчанию 'soun'. */
  handler?: string;
  /** Без mdat вовсе. */
  noMdat?: boolean;
  /** Отрезать от конца mdat столько байт (кадры таблицы вылезают за присланное). */
  mdatShortBy?: number;
  /** Сдвинуть все смещения чанков на столько байт. */
  chunkShift?: number;
  /** moov перед mdat (как AVAudioFile), а не после (как ffmpeg). */
  moovFirst?: boolean;
  /** Одинаковый размер кадра в stsz вместо таблицы. */
  constantSize?: boolean;
  /** Все чанки указывают на одни и те же байты, в mdat — только первый чанк. */
  reuseFirstChunk?: boolean;
  /** Смещения чанков 64-битные (co64). */
  co64?: boolean;
}

export function box(type: string, ...bodies: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(...bodies);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** uint32 подряд; массивом, а не аргументами — таблица на 2.5 ч не влезает в стек вызова. */
function u32s(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setUint32(i * 4, v));
  return out;
}

/** Полный бокс (версия+флаги = 0) с 32-битными полями. */
const fullBox = (type: string, values: readonly number[]) => box(type, u32s([0, ...values]));

function mvhd(seconds: number): Uint8Array {
  const body = new Uint8Array(100);
  const dv = new DataView(body.buffer);
  dv.setUint32(12, 1000);
  dv.setUint32(16, Math.round(seconds * 1000));
  return box("mvhd", body);
}

function mdhd(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(24);
  const dv = new DataView(body.buffer);
  dv.setUint32(12, timescale);
  dv.setUint32(16, duration);
  return box("mdhd", body);
}

function hdlr(handler: string): Uint8Array {
  const body = new Uint8Array(25);
  body.set(new TextEncoder().encode(handler.padEnd(4, " ").slice(0, 4)), 8);
  return box("hdlr", body);
}

function stbl(frames: number, o: Overrides, chunkOffsets: number[]): Uint8Array {
  const declared = frames + (o.extraDeclaredFrames ?? 0);
  const size = o.frameBytes ?? 16;
  const stts = fullBox("stts", [1, declared, o.frameDelta ?? FRAME]);
  const stsz = o.constantSize
    ? fullBox("stsz", [size, declared])
    : box("stsz", u32s([0, 0, declared]), u32s(new Array<number>(declared).fill(size)));
  const stsc = fullBox("stsc", [1, 1, FRAMES_PER_CHUNK, 1]);
  const stco = o.co64
    ? box("co64", u32s([0, chunkOffsets.length]), u32s(chunkOffsets.flatMap((c) => [0, c])))
    : box("stco", u32s([0, chunkOffsets.length]), u32s(chunkOffsets));
  return box("stbl", box("stsd", u32s([0, 0])), stts, stsz, stsc, stco);
}

function moov(seconds: number, frames: number, o: Overrides, chunkOffsets: number[]): Uint8Array {
  const timescale = SAMPLE_RATE;
  const trak = box(
    "trak",
    box(
      "mdia",
      mdhd(timescale, frames * (o.frameDelta ?? FRAME)),
      hdlr(o.handler ?? "soun"),
      box("minf", stbl(frames, o, chunkOffsets)),
    ),
  );
  return box("moov", mvhd(o.mvhdSec ?? seconds), trak);
}

/** .m4a длиной `seconds` по содержимому; `o` портит один признак. */
export function m4aOf(seconds: number, o: Overrides = {}): Uint8Array<ArrayBuffer> {
  const frames = Math.max(1, Math.round((seconds * SAMPLE_RATE) / FRAME));
  const declared = frames + (o.extraDeclaredFrames ?? 0);
  const payload = new Uint8Array(frames * (o.frameBytes ?? 16));
  const ftyp = box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A isom"));
  const chunkCount = Math.ceil(declared / FRAMES_PER_CHUNK);
  const chunkBytes = FRAMES_PER_CHUNK * (o.frameBytes ?? 16);
  const offsetsFrom = (mdatStart: number) =>
    Array.from(
      { length: chunkCount },
      (_, i) => mdatStart + 8 + (o.reuseFirstChunk ? 0 : i * chunkBytes) + (o.chunkShift ?? 0),
    );
  const mdatBody = o.reuseFirstChunk
    ? payload.subarray(0, chunkBytes)
    : payload.subarray(0, payload.length - (o.mdatShortBy ?? 0));
  const mdat = o.noMdat ? new Uint8Array(0) : box("mdat", mdatBody);
  if (!o.moovFirst) return concat(ftyp, mdat, moov(seconds, frames, o, offsetsFrom(ftyp.length)));
  // Размер moov от смещений не зависит (они фиксированной ширины) — считаем его на пробных.
  const probe = moov(seconds, frames, o, offsetsFrom(0));
  return concat(ftyp, moov(seconds, frames, o, offsetsFrom(ftyp.length + probe.length)), mdat);
}
