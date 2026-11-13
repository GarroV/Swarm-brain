// Тесты охраны частей аудио (#150).
// Запуск: deno test -A --no-check supabase/functions/_shared/audio-part-guard.test.ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  blobDurationSeconds,
  isPartPending,
  markSkipped,
  MAX_PART_ATTEMPTS,
  MIN_WHISPER_PART_SECONDS,
  registerPartFailure,
  tooShortReason,
} from "./audio-part-guard.ts";

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}
function mvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(version === 1 ? 36 : 28);
  const v = new DataView(body.buffer);
  v.setUint8(0, version);
  if (version === 1) {
    v.setUint32(20, timescale);
    v.setBigUint64(24, BigInt(duration));
  } else {
    v.setUint32(12, timescale);
    v.setUint32(16, duration);
  }
  return box("mvhd", body);
}
function m4a(version: 0 | 1, timescale: number, duration: number): Blob {
  const ftyp = box("ftyp", new TextEncoder().encode("M4A \0\0\0\0"));
  const mdat = box("mdat", new Uint8Array(100));
  return new Blob([ftyp, mdat, box("moov", mvhd(version, timescale, duration))]); // moov в конце, как у рекордера
}

Deno.test("длительность читается из mvhd (v0 и v1), moov в конце файла", async () => {
  assertEquals(await blobDurationSeconds(m4a(0, 1000, 67)), 0.067);
  assertEquals(await blobDurationSeconds(m4a(1, 44100, 44100 * 3)), 3);
});

Deno.test("не m4a или битый файл — длительность неизвестна, не пропускаем", async () => {
  assertEquals(await blobDurationSeconds(new Blob([new Uint8Array(50)])), null);
  assertEquals(await blobDurationSeconds(new Blob([])), null);
  assertEquals(tooShortReason(null), null);
});

Deno.test("часть короче порога Whisper — причина с цифрами; на пороге и выше — годная", async () => {
  const reason = tooShortReason(await blobDurationSeconds(m4a(0, 1000, 67)));
  assert(reason !== null);
  assertStringIncludes(reason, "too_short");
  assertStringIncludes(reason, "0.067");
  assertEquals(tooShortReason(MIN_WHISPER_PART_SECONDS), null);
  assertEquals(tooShortReason(488), null);
});

Deno.test("пропущенная при регистрации часть не ждёт транскрибации, причина в state", () => {
  const p = { path: "m/sys_3.m4a", done: false, attempts: 0 } as {
    path: string;
    done: boolean;
    attempts: number;
    skipped?: string;
  };
  assert(isPartPending(p));
  markSkipped(p, "too_short: 0.067s");
  assertEquals(isPartPending(p), false);
  assertEquals(p.skipped, "too_short: 0.067s");
  assertEquals(p.done, false);
});

Deno.test("провалы части: причина сохраняется, poison-guard срабатывает ровно на последней попытке", () => {
  const p: { path: string; done: boolean; attempts: number; error?: string; skipped?: string } = {
    path: "m/sys_3.m4a",
    done: false,
    attempts: 0,
  };
  for (let i = 1; i < MAX_PART_ATTEMPTS; i++) {
    assertEquals(registerPartFailure(p, new Error("Whisper 400: audio too short")), null);
    assertEquals(isPartPending(p), true);
    assertEquals(p.skipped, undefined);
  }
  const line = registerPartFailure(p, new Error("Whisper 400: audio too short"));
  assert(line !== null);
  assertStringIncludes(line, "m/sys_3.m4a");
  assertStringIncludes(line, "audio too short");
  assertEquals(p.attempts, MAX_PART_ATTEMPTS);
  assertEquals(isPartPending(p), false);
  assertStringIncludes(p.skipped ?? "", "poison");
  assertStringIncludes(p.error ?? "", "audio too short");
});

Deno.test("причина усекается, чтобы не раздувать jsonb", () => {
  const p = { path: "x", done: false, attempts: 0, error: undefined as string | undefined };
  registerPartFailure(p, "я".repeat(5000));
  assert((p.error ?? "").length <= 300);
});
