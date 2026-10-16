import { assertEquals } from "jsr:@std/assert@1";
import { classifyApiFailure, isExpiredRecording, ownedRecordings, recordedSeconds } from "./logic.ts";
import type { RecordingRec } from "./types.ts";

const rec = (rid: string, ownerId: number | undefined): RecordingRec =>
  ({ rid, ownerId, serverId: null, startedAt: "2026-10-16T10:00:00Z", mime: "audio/mp4", lastSeenMs: 0 } as RecordingRec);

Deno.test("recordedSeconds: паузы вычитаются, текущая пауза тоже", () => {
  const base = { startedMs: 0, endedMs: 600_000, gapMs: 0 };
  assertEquals(recordedSeconds(base), 600);
  assertEquals(recordedSeconds({ ...base, gapMs: 14_000 }), 586);
  // Стоп из «прервалось»: трек умер на 400-й секунде, «Продолжить» не нажали.
  assertEquals(recordedSeconds({ ...base, ongoingGapStartMs: 400_000 }), 400);
  assertEquals(recordedSeconds({ startedMs: 0, endedMs: 1000, gapMs: 5000 }), 0);
});

Deno.test("ownedRecordings: чужие и безымянные записи не возвращаются", () => {
  const all = [rec("a", 1), rec("b", 2), rec("legacy", undefined)];
  assertEquals(ownedRecordings(all, 2).map((r) => r.rid), ["b"]);
  assertEquals(ownedRecordings(all, null), []);
});

Deno.test("classifyApiFailure: фатально только точное имя кода, голые 403/404/409 — повтор", () => {
  assertEquals(classifyApiFailure(404, { code: "not_found" }), "not-found");
  assertEquals(classifyApiFailure(403, { code: "forbidden" }), "not-found");
  assertEquals(classifyApiFailure(409, { code: "already_finished" }), "finished");
  assertEquals(classifyApiFailure(403, { code: "demo_not_allowed" }), "demo");
  assertEquals(classifyApiFailure(429, { code: "too_many_open" }), "too-many-open");
  assertEquals(classifyApiFailure(400, { code: "empty_segment" }), "rejected");
  assertEquals(classifyApiFailure(413, {}), "too-large");
  assertEquals(classifyApiFailure(404, { error: "Not Found" }), null);
  assertEquals(classifyApiFailure(403, null), null);
  assertEquals(classifyApiFailure(401, { error: "unauthorized" }), null);
  assertEquals(classifyApiFailure(503, { code: "maintenance" }), null);
});

Deno.test("isExpiredRecording: старше 3 дней по последним данным — чистим, свежее — нет", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const day = 86_400_000;
  const r = (lastSeenMs: number, startedAt = "2026-10-01T00:00:00Z") => ({ ...rec("x", 1), lastSeenMs, startedAt });
  assertEquals(isExpiredRecording(r(now - 4 * day), now), true);
  assertEquals(isExpiredRecording(r(now - 2 * day), now), false);
  // Свежие данные важнее давнего начала: длинная запись не должна пропасть.
  assertEquals(isExpiredRecording(r(now - day, "2026-10-01T00:00:00Z"), now), false);
  // Нет lastSeen — судим по началу.
  assertEquals(isExpiredRecording(r(0, "2026-10-01T00:00:00Z"), now), true);
});
