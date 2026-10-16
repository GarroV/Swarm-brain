// Запуск: deno test supabase/functions/swarm-api/web-recording.test.ts
//
// Права на запись из браузера: SERVICE_ROLE обходит RLS, поэтому «чья это запись» решает только код
// модуля. Ошибка тут — чужой человек льёт аудио в чужую встречу или завершает её.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fakeSupabase, type Row } from "../_shared/web-recording-fake.ts";
import { MAX_SEGMENT_BYTES, WEB_RECORDER_SOURCE } from "../_shared/web-recording.ts";
import { handleWebRecordingRoutes, MAX_OPEN_RECORDINGS, type WebRecordingContext } from "./web-recording.ts";

const ID = "22222222-2222-4222-8222-222222222222";
const ME = 100;

const untouchable = new Proxy({}, {
  get(_t, prop) {
    throw new Error(`база не должна трогаться при отказе (обращение к ${String(prop)})`);
  },
}) as SupabaseClient;

const meetingRow = (over: Row = {}): Row => ({
  id: ID,
  group_id: "ws1",
  source: WEB_RECORDER_SOURCE,
  claim_owner: ME,
  summary_status: null,
  started_at: "2026-10-16T10:00:00.000Z",
  ...over,
});

function ctx(db: SupabaseClient, over: Partial<WebRecordingContext> = {}): WebRecordingContext {
  return {
    supabase: db,
    telegramId: ME,
    groupId: "ws1",
    isDemo: false,
    origin: "http://localhost",
    runStep: () => Promise.resolve(),
    ...over,
  };
}

const audio = (n = 10, type = "audio/mp4") => ({ body: new Uint8Array(n), headers: { "content-type": type } });
const put = (path: string, init: { body?: BodyInit; headers?: Record<string, string> } = audio()) =>
  new Request(`http://localhost${path}`, { method: "PUT", ...init });
const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const SEG = `/meetings/record/${ID}/segments/0?offset=0`;

async function call(c: WebRecordingContext, req: Request) {
  const res = await handleWebRecordingRoutes(c, req, new URL(req.url).pathname);
  return { res: res!, body: await res!.json() };
}

Deno.test("чужие пути модуль не берёт", async () => {
  const res = await handleWebRecordingRoutes(ctx(untouchable), post("/meetings/abc"), "/meetings/abc");
  assertEquals(res, null);
});

Deno.test("БЛОКИРУЮЩИЙ: чужая запись — 403 forbidden, кусок не заливается", async () => {
  const db = fakeSupabase({ meetings: [meetingRow({ claim_owner: 999 })] });
  const { res, body } = await call(ctx(db.client), put(SEG));
  assertEquals(res.status, 403);
  assertEquals(body.code, "forbidden");
  assertEquals(db.uploads, []);
});

Deno.test("БЛОКИРУЮЩИЙ: чужой воркспейс и не-запись-из-браузера — 404, существование не подтверждается", async () => {
  for (const over of [{ group_id: "other" }, { source: "desktop-agent" }]) {
    const db = fakeSupabase({ meetings: [meetingRow(over)] });
    const { res, body } = await call(ctx(db.client), put(SEG));
    assertEquals([res.status, body.code], [404, "not_found"]);
    assertEquals(db.uploads, []);
  }
});

Deno.test("несуществующий и невалидный id — 404", async () => {
  const db = fakeSupabase({ meetings: [] });
  assertEquals((await call(ctx(db.client), put(SEG))).res.status, 404);
  assertEquals((await call(ctx(untouchable), put("/meetings/record/not-a-uuid/segments/0?offset=0"))).res.status, 404);
});

Deno.test("завершённая запись — 409 already_finished и для куска, и для finish", async () => {
  const db = fakeSupabase({ meetings: [meetingRow({ summary_status: "processing" })] });
  const a = await call(ctx(db.client), put(SEG));
  assertEquals([a.res.status, a.body.code], [409, "already_finished"]);
  const b = await call(ctx(db.client), post(`/meetings/record/${ID}/finish`));
  assertEquals([b.res.status, b.body.code], [409, "already_finished"]);
  assertEquals(db.uploads, []);
});

Deno.test("демо: все записи — 403 demo_not_allowed до обращения к базе", async () => {
  const c = ctx(untouchable, { isDemo: true });
  for (const req of [post("/meetings/record"), put(SEG), post(`/meetings/record/${ID}/finish`)]) {
    const { res, body } = await call(c, req);
    assertEquals([res.status, body.code], [403, "demo_not_allowed"]);
  }
});

Deno.test("кусок: путь по номеру и смещению, формат по Content-Type, updated_at сдвигается", async () => {
  const db = fakeSupabase({ meetings: [meetingRow({ updated_at: "2000-01-01T00:00:00.000Z" })] });
  const { res, body } = await call(ctx(db.client), put(`/meetings/record/${ID}/segments/3?offset=900.5`, audio(5)));
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, n: 3, bytes: 5 });
  assertEquals(db.uploads, [{ path: `${ID}/web/003-900500.m4a`, contentType: "audio/mp4", bytes: 5 }]);
  assertEquals((db.meetings[0].updated_at as string) > "2000-01-01T00:00:00.000Z", true);

  const web = await call(
    ctx(db.client),
    put(`/meetings/record/${ID}/segments/4?offset=1200`, audio(5, "audio/webm;codecs=opus")),
  );
  assertEquals(web.res.status, 200);
  assertEquals(db.uploads[1].path, `${ID}/web/004-1200000.webm`);
});

Deno.test("повтор куска с другим смещением убирает прежний файл того же номера", async () => {
  const db = fakeSupabase({
    meetings: [meetingRow()],
    files: [{ name: "003-900000.m4a" }, { name: "003-900500.m4a" }, { name: "013-1.m4a" }],
  });
  await call(ctx(db.client), put(`/meetings/record/${ID}/segments/3?offset=900.5`));
  assertEquals(db.removed, [`${ID}/web/003-900000.m4a`]);
});

Deno.test("кусок: плохой номер, смещение, тип, пустое и слишком большое тело", async () => {
  const db = fakeSupabase({ meetings: [meetingRow()] });
  const c = ctx(db.client);
  const base = `/meetings/record/${ID}/segments`;
  const cases: [string, Request, number, string][] = [
    ["n=1000", put(`${base}/1000?offset=0`), 400, "bad_segment"],
    ["n=abc", put(`${base}/abc?offset=0`), 400, "bad_segment"],
    ["без offset", put(`${base}/0`), 400, "bad_offset"],
    ["offset=NaN", put(`${base}/0?offset=NaN`), 400, "bad_offset"],
    ["offset<0", put(`${base}/0?offset=-1`), 400, "bad_offset"],
    ["offset>сутки", put(`${base}/0?offset=86401`), 400, "bad_offset"],
    ["тип", put(`${base}/0?offset=0`, audio(5, "text/plain")), 415, "unsupported_media"],
    ["пусто", put(`${base}/0?offset=0`, audio(0)), 400, "empty_segment"],
    ["велик", put(`${base}/0?offset=0`, audio(MAX_SEGMENT_BYTES + 1)), 413, "segment_too_large"],
  ];
  for (const [name, req, status, code] of cases) {
    const { res, body } = await call(c, req);
    assertEquals([name, res.status, body.code], [name, status, code]);
  }
  assertEquals(db.uploads, []);
});

Deno.test("старт: строка встречи с автором в recorders и claim_owner, без участников", async () => {
  const db = fakeSupabase();
  const { res, body } = await call(ctx(db.client), post("/meetings/record", { started_at: "2026-10-16T12:30:00Z" }));
  assertEquals(res.status, 201);
  const row = db.meetings[0];
  assertEquals(body.id, row.id);
  assertEquals(row.source, WEB_RECORDER_SOURCE);
  assertEquals(row.claim_owner, ME);
  assertEquals(row.group_id, "ws1");
  assertEquals((row.recorders as { telegram_id: number }[]).map((r) => r.telegram_id), [ME]);
  assertEquals(row.attendees, []);
  assertEquals(row.identity_kind, "manual");
  assertEquals((row.identity_key as string).startsWith("web:"), true);
  assertEquals(row.title, body.title);
  assertEquals(String(row.title).startsWith("Офлайн-встреча"), true);
});

Deno.test("старт: своё название сохраняется, мусорное тело — 400", async () => {
  const db = fakeSupabase();
  const ok = await call(ctx(db.client), post("/meetings/record", { title: "  Планёрка  " }));
  assertEquals(ok.body.title, "Планёрка");
  assertEquals((await call(ctx(db.client), post("/meetings/record", { started_at: "вчера" }))).res.status, 400);
  assertEquals((await call(ctx(db.client), post("/meetings/record", [1]))).res.status, 400);
});

Deno.test("finish: куски уходят в обработку и запускается один проход", async () => {
  const db = fakeSupabase({ meetings: [meetingRow()], files: [{ name: "000-0.m4a" }, { name: "001-300000.m4a" }] });
  const ran: string[] = [];
  const c = ctx(db.client, { runStep: (id) => (ran.push(id), Promise.resolve()) });
  const { res, body } = await call(c, post(`/meetings/record/${ID}/finish`, { recorded_seconds: 420 }));
  assertEquals(res.status, 202);
  assertEquals(body, { ok: true, id: ID, summary_status: "processing", segments: 2 });
  assertEquals(db.meetings[0].summary_status, "processing");
  assertEquals(db.meetings[0].recorded_seconds, 420);
  assertEquals(ran, [ID]);
});

Deno.test("finish без кусков — failed и обработка не запускается; плохие поля — 400", async () => {
  const db = fakeSupabase({ meetings: [meetingRow()] });
  const ran: string[] = [];
  const c = ctx(db.client, { runStep: (id) => (ran.push(id), Promise.resolve()) });
  assertEquals((await call(c, post(`/meetings/record/${ID}/finish`, { recorded_seconds: -5 }))).res.status, 400);
  const { res, body } = await call(c, post(`/meetings/record/${ID}/finish`));
  assertEquals([res.status, body.summary_status, body.segments], [202, "failed", 0]);
  assertEquals(ran, []);
});

Deno.test("active: только своя незавершённая запись и номера её кусков; чужой воркспейс не виден", async () => {
  const db = fakeSupabase({
    meetings: [meetingRow(), meetingRow({ id: "other", claim_owner: 999 })],
    files: [{ name: "000-0.m4a" }, { name: "001-300000.m4a" }],
  });
  const { body } = await call(ctx(db.client), new Request("http://localhost/meetings/record/active"));
  assertEquals(body, { recording: { id: ID, started_at: "2026-10-16T10:00:00.000Z", segments: [0, 1] } });
  const none = await call(ctx(db.client, { groupId: "ws2" }), new Request("http://localhost/meetings/record/active"));
  assertEquals(none.body, { recording: null });
});

Deno.test("БЛОКИРУЮЩИЙ: кусок потоком без Content-Length сверх потолка — 413, поток оборван, в Storage ничего", async () => {
  const db = fakeSupabase({ meetings: [meetingRow()] });
  let cancelled = false;
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent++;
      controller.enqueue(chunk);
      if (sent > 200) controller.close(); // страховка теста: без обрыва поток дошёл бы до 200 МБ
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request(`http://localhost${SEG}`, {
    method: "PUT",
    body: stream,
    headers: { "content-type": "audio/mp4" },
    // @ts-ignore: duplex нужен для потокового тела, в типах Request его нет
    duplex: "half",
  });
  assertEquals(req.headers.get("content-length"), null);
  const { res, body } = await call(ctx(db.client), req);
  assertEquals([res.status, body.code], [413, "segment_too_large"]);
  assertEquals(cancelled, true);
  assertEquals(sent <= MAX_SEGMENT_BYTES / chunk.byteLength + 2, true);
  assertEquals(db.uploads, []);
});

Deno.test("тело JSON больше 4096 байт — 400, строка не заводится", async () => {
  const db = fakeSupabase();
  const { res, body } = await call(ctx(db.client), post("/meetings/record", { title: "x".repeat(5000) }));
  assertEquals([res.status, body.code], [400, "bad_request"]);
  assertEquals(db.meetings, []);
});

Deno.test("БЛОКИРУЮЩИЙ: четвёртая открытая запись — 429 too_many_open; завершённые, чужие и из другого воркспейса не считаются", async () => {
  const open = (i: number) => meetingRow({ id: `open-${i}` });
  const db = fakeSupabase({
    meetings: [
      ...Array.from({ length: MAX_OPEN_RECORDINGS - 1 }, (_, i) => open(i)),
      meetingRow({ id: "done-1", summary_status: "done" }),
      meetingRow({ id: "failed-1", summary_status: "failed" }),
      meetingRow({ id: "alien", claim_owner: 999 }),
      meetingRow({ id: "other-ws", group_id: "ws2" }),
    ],
  });
  const before = db.meetings.length;
  const third = await call(ctx(db.client), post("/meetings/record"));
  assertEquals(third.res.status, 201); // открытых было 2 — третья проходит
  const fourth = await call(ctx(db.client), post("/meetings/record"));
  assertEquals([fourth.res.status, fourth.body.code], [429, "too_many_open"]);
  assertEquals(db.meetings.length, before + 1);
});
