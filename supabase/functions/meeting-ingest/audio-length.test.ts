// Длина выгруженного аудио, измеренная сервером (T160). От неё зависит, чья запись станет
// стенограммой (перехват права claim проверяется по ней, а не по заявке клиента), поэтому ошибка
// здесь — не шум: «не удалось измерить» обязано быть null, а не нулём или суточной цифрой.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mp4DurationSec, trackCoverageSec } from "./audio-length.ts";

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function mvhdV0(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(100);
  const dv = new DataView(body.buffer);
  dv.setUint32(12, timescale);
  dv.setUint32(16, duration);
  return box("mvhd", body);
}

function mvhdV1(timescale: number, duration: bigint): Uint8Array {
  const body = new Uint8Array(112);
  const dv = new DataView(body.buffer);
  body[0] = 1;
  dv.setUint32(20, timescale);
  dv.setBigUint64(24, duration);
  return box("mvhd", body);
}

const ftyp = box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A isom"));
const mdat = (n: number) => box("mdat", new Uint8Array(n));

Deno.test("mp4: длительность из mvhd версии 0, moov после mdat (как пишет ffmpeg)", () => {
  const file = concat(ftyp, mdat(4096), box("moov", mvhdV0(44_100, 44_100 * 900)));
  assertAlmostEquals(mp4DurationSec(file) ?? -1, 900, 1e-9);
});

Deno.test("mp4: mvhd версии 1 (64-битная длительность), moov перед mdat", () => {
  const file = concat(ftyp, box("moov", mvhdV1(1000, 5_400_500n)), mdat(16));
  assertAlmostEquals(mp4DurationSec(file) ?? -1, 5400.5, 1e-9);
});

Deno.test("mp4: не-mp4, пустой файл и обрезанный заголовок — не измерено (null)", () => {
  assertEquals(mp4DurationSec(new TextEncoder().encode("label:12:0")), null);
  assertEquals(mp4DurationSec(new Uint8Array(0)), null);
  const moov = box("moov", mvhdV0(1000, 60_000));
  assertEquals(mp4DurationSec(concat(ftyp, moov.subarray(0, 20))), null);
});

Deno.test("mp4: нулевая шкала, нулевая и «неизвестная» длительность — не измерено", () => {
  assertEquals(mp4DurationSec(concat(ftyp, box("moov", mvhdV0(0, 1000)))), null);
  assertEquals(mp4DurationSec(concat(ftyp, box("moov", mvhdV0(1000, 0)))), null);
  assertEquals(mp4DurationSec(concat(ftyp, box("moov", mvhdV0(1000, 0xffff_ffff)))), null);
});

Deno.test("mp4: размер бокса, вылезающий за файл, — не измерено, а не чтение мусора", () => {
  const moov = box("moov", mvhdV0(1000, 60_000));
  new DataView(moov.buffer).setUint32(0, moov.length + 1000);
  assertEquals(mp4DurationSec(concat(ftyp, moov)), null);
});

Deno.test("mp4: без moov (фрагменты, обрыв записи) — не измерено", () => {
  assertEquals(mp4DurationSec(concat(ftyp, mdat(64))), null);
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
