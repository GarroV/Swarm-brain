// Запуск: deno test supabase/functions/_shared/web-recording.test.ts
//
// Ядро записи из браузера: из чего собираются части обработки. Ошибка тут молчаливая — куски в
// другом порядке или с неверным смещением дают вполне правдоподобную, но перепутанную стенограмму.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase, type Row } from "./web-recording-fake.ts";
import {
  buildWebParts,
  finalizeWebRecording,
  parseSegments,
  segmentPath,
  WEB_RECORDER_SOURCE,
} from "./web-recording.ts";
import type { ProcessState } from "./meeting-processor.ts";

const ID = "11111111-1111-4111-8111-111111111111";

const webRow = (over: Row = {}): Row => ({
  id: ID,
  source: WEB_RECORDER_SOURCE,
  claim_owner: 42,
  summary_status: null,
  ...over,
});

Deno.test("segmentPath: номер с нулями, смещение в миллисекундах, расширение по формату", () => {
  assertEquals(segmentPath(ID, 7, 300.5, "m4a"), `${ID}/web/007-300500.m4a`);
  assertEquals(segmentPath(ID, 12, 0, "webm"), `${ID}/web/012-0.webm`);
});

Deno.test("parseSegments: порядок по номеру, а не по имени в списке; чужие файлы пропущены", () => {
  const segs = parseSegments([
    { name: "010-3000000.m4a", stamp: "a" },
    { name: "002-600000.m4a", stamp: "a" },
    { name: "notes.txt", stamp: "a" },
    { name: "000-0.m4a", stamp: "a" },
  ]);
  assertEquals(segs.map((s) => s.n), [0, 2, 10]);
  assertEquals(segs.map((s) => s.offsetMs), [0, 600000, 3000000]);
});

Deno.test("parseSegments: два файла одного номера — остаётся свежий", () => {
  const segs = parseSegments([
    { name: "003-900000.m4a", stamp: "2026-10-16T10:00:00Z" },
    { name: "003-905000.webm", stamp: "2026-10-16T10:05:00Z" },
  ]);
  assertEquals(segs.length, 1);
  assertEquals(segs[0].name, "003-905000.webm");
});

Deno.test("buildWebParts: дорожка mic, смещение в секундах, путь в папке записи", () => {
  const parts = buildWebParts(ID, [{ n: 1, offsetMs: 300250, name: "001-300250.m4a" }]);
  assertEquals(parts, [{
    track: "mic",
    name: "001-300250.m4a",
    offset: 300.25,
    path: `${ID}/web/001-300250.m4a`,
    done: false,
    attempts: 0,
  }]);
});

Deno.test("finalize: куски собраны по порядку, строка уходит в обработку с источником web:<автор>", async () => {
  const db = fakeSupabase({
    meetings: [webRow()],
    files: [{ name: "001-300000.m4a" }, { name: "000-0.m4a" }],
  });
  const res = await finalizeWebRecording(db.client, ID, { endedAt: "2026-10-16T12:00:00.000Z", recordedSeconds: 540 });
  assertEquals(res, { parts: 2 });
  const row = db.meetings[0];
  assertEquals(row.summary_status, "processing");
  assertEquals(row.ended_at, "2026-10-16T12:00:00.000Z");
  assertEquals(row.recorded_seconds, 540);
  assertEquals(row.processing_lease, null);
  assertEquals(typeof row.last_progress_at, "string");
  const state = row.process_state as ProcessState;
  assertEquals(state.stage, "transcribe");
  assertEquals(state.source, "web:42");
  assertEquals(state.sources, ["web:42"]);
  assertEquals(state.owner, 42);
  assertEquals(state.parts.map((p) => [p.name, p.offset]), [["000-0.m4a", 0], ["001-300000.m4a", 300]]);
});

Deno.test("finalize идемпотентна: повтор не пересобирает состояние", async () => {
  const db = fakeSupabase({ meetings: [webRow()], files: [{ name: "000-0.m4a" }] });
  await finalizeWebRecording(db.client, ID);
  const before = JSON.stringify(db.meetings[0].process_state);
  db.files.push({ name: "001-300000.m4a" }); // кусок «дошёл» уже после завершения
  assertEquals(await finalizeWebRecording(db.client, ID), { already: true });
  assertEquals(JSON.stringify(db.meetings[0].process_state), before);
});

Deno.test("finalize: ни одного куска — 'failed', без process_state", async () => {
  const db = fakeSupabase({ meetings: [webRow()], files: [] });
  assertEquals(await finalizeWebRecording(db.client, ID), { failed: true, parts: 0 });
  assertEquals(db.meetings[0].summary_status, "failed");
  assertEquals(db.meetings[0].process_state, undefined);
});

Deno.test("finalize не трогает встречу, которая не запись из браузера", async () => {
  const db = fakeSupabase({ meetings: [webRow({ source: "desktop-agent" })], files: [{ name: "000-0.m4a" }] });
  assertEquals(await finalizeWebRecording(db.client, ID), { already: true });
  assertEquals(db.meetings[0].summary_status, null);
});

Deno.test("finalize: список Storage длиннее страницы читается целиком", async () => {
  const files = Array.from({ length: 150 }, (_, i) => ({ name: `${String(i).padStart(3, "0")}-${i * 1000}.m4a` }));
  const db = fakeSupabase({ meetings: [webRow()], files });
  assertEquals(await finalizeWebRecording(db.client, ID), { parts: 150 });
});
