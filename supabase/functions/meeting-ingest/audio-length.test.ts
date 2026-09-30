// Длина выгруженного аудио, измеренная сервером по содержимому файла. От неё зависит, чья запись
// станет стенограммой (перехват права claim проверяется по ней, а не по заявке клиента), поэтому
// ошибка здесь — не шум: «не удалось измерить» обязано быть null, а не нулём или суточной цифрой.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mp4DurationSec, trackCoverageSec } from "./audio-length.ts";
import { box, concat, m4aOf } from "./m4a-fixture.ts";

const ftyp = box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A isom"));

/** Заголовок, в котором длина есть, а звука нет, — так выглядел бы файл, собранный руками. */
function headerOnly(seconds: number, withMdat: boolean): Uint8Array {
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, 1000);
  new DataView(mvhd.buffer).setUint32(16, seconds * 1000);
  const moov = box("moov", box("mvhd", mvhd));
  return withMdat ? concat(ftyp, box("mdat", new Uint8Array(2048)), moov) : concat(ftyp, moov);
}

const testdata = (name: string) => Deno.readFileSync(new URL(`./testdata/${name}`, import.meta.url));

// Настоящие файлы клиентов (testdata/): бот — ffmpeg с флагами bot/src/container/segments.ts
// (48 кГц моно, 32k, -f segment -reset_timestamps 1 -segment_format ipod); рекордер — AVAudioFile
// (48 кГц 32k и 16 кГц 24k, как SystemAudioCapturer) и нарезка AVAssetExportSession passthrough
// (как Segmenter), плюс afconvert. Тишина — худший случай для нижней границы байт/с: кадр AAC
// тишины весит 4 байта. Длительности — то, что показывает ffprobe (format=duration).
const REAL: Array<[string, number]> = [
  ["bot-noise-000.m4a", 5.013333],
  ["bot-silence-000.m4a", 5.013333],
  ["bot-silence-001.m4a", 1.008],
  ["rec-part1-noise.m4a", 5.034667],
  ["rec-part0-silence.m4a", 5.184],
  ["rec-avfile-16k-silence.m4a", 8.192],
  ["afconvert-silence-24k.m4a", 20.096],
];

Deno.test("ЯДРО: настоящие файлы бота и рекордера меряются, как их показывает ffprobe", () => {
  for (const [name, seconds] of REAL) {
    const got = mp4DurationSec(testdata(name));
    if (got === null || Math.abs(got - seconds) > 0.05) throw new Error(`${name}: ${got} вместо ${seconds}`);
  }
});

Deno.test("ЯДРО: длина — по таблице сэмплов, а заголовок её только урезает", () => {
  assertAlmostEquals(mp4DurationSec(m4aOf(900)) ?? -1, 900, 0.05);
  assertAlmostEquals(mp4DurationSec(m4aOf(900, { mvhdSec: 12 * 3600 })) ?? -1, 900, 0.05);
  assertAlmostEquals(mp4DurationSec(m4aOf(900, { mvhdSec: 600 })) ?? -1, 600, 1e-9);
});

Deno.test("ЯДРО: заголовок без звука — не измерено, есть mdat или нет", () => {
  assertEquals(mp4DurationSec(headerOnly(1200, false)), null);
  assertEquals(mp4DurationSec(headerOnly(1200, true)), null);
  assertEquals(mp4DurationSec(m4aOf(600, { noMdat: true })), null);
});

Deno.test("ЯДРО: кадры таблицы вне присланного mdat — не измерено", () => {
  assertEquals(mp4DurationSec(m4aOf(600, { mdatShortBy: 1 })), null);
  assertEquals(mp4DurationSec(m4aOf(600, { chunkShift: 1 })), null);
  assertEquals(mp4DurationSec(m4aOf(600, { chunkShift: -9 })), null);
  assertEquals(mp4DurationSec(m4aOf(600, { extraDeclaredFrames: 5 })), null);
});

Deno.test("ЯДРО: одни и те же байты под всеми чанками засчитываются один раз — не измерено", () => {
  assertEquals(mp4DurationSec(m4aOf(600, { reuseFirstChunk: true })), null);
});

Deno.test("ЯДРО: слишком мало байт на секунду для AAC или слишком длинный кадр — не измерено", () => {
  assertEquals(mp4DurationSec(m4aOf(600, { frameBytes: 0 })), null);
  // 1 байт на кадр в 1024 сэмпла при 48 кГц — 47 байт/с: ниже любой тишины AAC у клиентов
  // (4 байта на кадр), но выше порога; тот же байт на кадр вдвое длиннее — 23 байт/с, ниже порога.
  assertAlmostEquals(mp4DurationSec(m4aOf(600, { frameBytes: 1 })) ?? -1, 600, 0.05);
  assertEquals(mp4DurationSec(m4aOf(600, { frameBytes: 1, frameDelta: 2048 })), null);
  // Кадр в полсекунды при 2000 байт/с: байт хватает, но кадров AAC такой длины не бывает.
  assertEquals(mp4DurationSec(m4aOf(600, { frameBytes: 1000, frameDelta: 24_000 })), null);
});

Deno.test("ЯДРО: огромные счётчики сэмплов при крошечном файле — не измерено и без долгого разбора", () => {
  const file = m4aOf(2, { constantSize: true, extraDeclaredFrames: 1_000_000_000, framesPerChunk: 1_000_000_000 });
  const t0 = performance.now();
  assertEquals(mp4DurationSec(file), null);
  const ms = performance.now() - t0;
  assertEquals(ms < 50, true, `разбор шёл ${ms.toFixed(0)} мс`);
});

Deno.test("mp4: moov до mdat, co64, одинаковый размер кадра в stsz — меряются", () => {
  assertAlmostEquals(mp4DurationSec(m4aOf(300, { moovFirst: true })) ?? -1, 300, 0.05);
  assertAlmostEquals(mp4DurationSec(m4aOf(300, { co64: true })) ?? -1, 300, 0.05);
  assertAlmostEquals(mp4DurationSec(m4aOf(300, { constantSize: true })) ?? -1, 300, 0.05);
});

Deno.test("mp4: дорожка не звуковая — не измерено", () => {
  assertEquals(mp4DurationSec(m4aOf(300, { handler: "vide" })), null);
});

Deno.test("mp4: не-mp4, пустой, обрезанный файл и бокс за концом файла — не измерено", () => {
  assertEquals(mp4DurationSec(new TextEncoder().encode("label:12:0")), null);
  assertEquals(mp4DurationSec(new Uint8Array(0)), null);
  const file = m4aOf(60);
  assertEquals(mp4DurationSec(file.subarray(0, file.length - 20)), null);
  const grown = m4aOf(60);
  new DataView(grown.buffer).setUint32(0, 1_000_000);
  assertEquals(mp4DurationSec(grown), null);
});

Deno.test("ЯДРО: охват — объединение интервалов частей обеих дорожек, пересечения не удваиваются", () => {
  assertEquals(
    trackCoverageSec([
      { offset: 0, durationSec: 600 },
      { offset: 600, durationSec: 600 },
      { offset: 1300, durationSec: 250 },
      { offset: 30, durationSec: 100 }, // вторая дорожка внутри первой части
    ]),
    1450,
  );
});

Deno.test("ЯДРО: offset — самоотчёт клиента, охват им не раздувается (часть на сутках даёт свою длину)", () => {
  assertEquals(trackCoverageSec([{ offset: 86_000, durationSec: 20 }]), 20);
  assertEquals(
    trackCoverageSec([{ offset: 0, durationSec: 60 }, { offset: 3_600, durationSec: 60 }]),
    120,
  );
});

Deno.test("ЯДРО: одна и та же часть, присланная дважды, считается один раз", () => {
  const part = { offset: 0, durationSec: 900 };
  assertEquals(trackCoverageSec([part, part, part]), 900);
});

Deno.test("охват дорожек: хоть одна часть не измерена или частей нет — null", () => {
  assertEquals(trackCoverageSec([{ offset: 0, durationSec: 600 }, { offset: 600, durationSec: null }]), null);
  assertEquals(trackCoverageSec([]), null);
});
