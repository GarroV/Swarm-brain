import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// tasks/db.ts создаёт клиент базы при импорте: без env он падает. Подставляем заглушку, только если
// настоящей нет (в CI со стендом env настоящий); до сети эти тесты не доходят.
for (const [k, v] of [["SUPABASE_URL", "http://127.0.0.1:1"], ["SUPABASE_SERVICE_ROLE_KEY", "x"]]) {
  if (!Deno.env.get(k)) Deno.env.set(k, v);
}
const { audioExt, clientToday, handleBoardRoutes, MAX_VOICE_BYTES, validDate } = await import("./board.ts");

const ctx = (over: Record<string, unknown> = {}) => ({
  supabase: {} as unknown as SupabaseClient,
  telegramId: 1,
  groupId: "g",
  isDemo: false,
  origin: "",
  ...over,
});

/** multipart-запрос с честным Content-Length, как у рекордера (new Request его сам не ставит). */
async function multipartReq(form: FormData, headers: Record<string, string> = {}): Promise<Request> {
  const packed = new Response(form);
  const body = await packed.arrayBuffer();
  return new Request("http://x/tasks/voice", {
    method: "POST",
    body,
    headers: {
      "content-type": packed.headers.get("content-type")!,
      "content-length": String(body.byteLength),
      ...headers,
    },
  });
}

function voiceReq(file: File | null, headers: Record<string, string> = {}): Promise<Request> {
  const form = new FormData();
  if (file) form.append("audio", file);
  return multipartReq(form, headers);
}

Deno.test("validDate: календарная дата проходит, остальное нет", () => {
  assertEquals(validDate("2026-10-22"), "2026-10-22");
  assertEquals(validDate("2026-02-30"), null);
  assertEquals(validDate("22.10.2026"), null);
  assertEquals(validDate(null), null);
});

Deno.test("clientToday: дата клиента главнее; без неё — по поясу клиента", () => {
  const now = new Date("2026-10-22T23:30:00Z");
  assertEquals(clientToday("2026-10-25", "120", now), "2026-10-25");
  assertEquals(clientToday(null, "120", now), "2026-10-23"); // Белград уже за полночью
  assertEquals(clientToday(null, "-300", now), "2026-10-22");
});

Deno.test("audioExt: m4a/webm/wav по MIME или расширению, остальное — null", () => {
  assertEquals(audioExt("audio/mp4", "x"), "m4a");
  assertEquals(audioExt("audio/x-m4a", "x"), "m4a");
  assertEquals(audioExt("audio/webm;codecs=opus", "x"), "webm");
  assertEquals(audioExt("audio/wav", "x"), "wav");
  assertEquals(audioExt("application/octet-stream", "clip.m4a"), "m4a");
  assertEquals(audioExt("", "clip.WAV"), "wav");
  assertEquals(audioExt("image/png", "clip.m4a"), null);
  assertEquals(audioExt("application/octet-stream", "clip.exe"), null);
});

async function code(res: Response | null): Promise<[number, string | undefined]> {
  const r = res!;
  return [r.status, (await r.json()).code];
}

Deno.test("голос: демо закрыто", async () => {
  const res = await handleBoardRoutes(
    ctx({ isDemo: true }),
    await voiceReq(new File(["a"], "a.m4a", { type: "audio/mp4" })),
    "/tasks/voice",
  );
  assertEquals(await code(res), [403, "demo_not_allowed"]);
});

Deno.test("голос: чужой тип, пустой файл, нет файла, слишком большой", async () => {
  const route = "/tasks/voice";
  assertEquals(
    await code(await handleBoardRoutes(ctx(), await voiceReq(new File(["a"], "a.png", { type: "image/png" })), route)),
    [415, "unsupported_media"],
  );
  assertEquals(
    await code(await handleBoardRoutes(ctx(), await voiceReq(new File([], "a.m4a", { type: "audio/mp4" })), route)),
    [400, "bad_audio"],
  );
  assertEquals(await code(await handleBoardRoutes(ctx(), await voiceReq(null), route)), [400, "bad_audio"]);
  const big = new File([new Uint8Array(MAX_VOICE_BYTES + 1)], "a.m4a", { type: "audio/mp4" });
  assertEquals(await code(await handleBoardRoutes(ctx(), await voiceReq(big), route)), [413, "audio_too_large"]);
  // по заголовку отказ приходит до чтения тела
  const declared = await voiceReq(new File(["a"], "a.m4a", { type: "audio/mp4" }), {
    "content-length": String(MAX_VOICE_BYTES * 2),
  });
  assertEquals(await code(await handleBoardRoutes(ctx(), declared, route)), [413, "audio_too_large"]);
});

Deno.test("голос: не multipart и кривая дата", async () => {
  const json = new Request("http://x/tasks/voice", {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", "content-length": "2" },
  });
  assertEquals(await code(await handleBoardRoutes(ctx(), json, "/tasks/voice")), [400, "bad_request"]);
  const form = new FormData();
  form.append("audio", new File(["a"], "a.m4a", { type: "audio/mp4" }));
  form.append("date", "завтра");
  const bad = await multipartReq(form);
  assertEquals(await code(await handleBoardRoutes(ctx(), bad, "/tasks/voice")), [400, "bad_date"]);
});

Deno.test("чужие пути и методы", async () => {
  assertEquals(await handleBoardRoutes(ctx(), new Request("http://x/tasks"), "/tasks"), null);
  assertEquals(
    (await handleBoardRoutes(ctx(), new Request("http://x/board/today", { method: "POST" }), "/board/today"))!.status,
    405,
  );
  assertEquals((await handleBoardRoutes(ctx(), new Request("http://x/tasks/voice"), "/tasks/voice"))!.status, 405);
  assertEquals(
    (await handleBoardRoutes(ctx(), new Request("http://x/board/today?date=bad"), "/board/today"))!.status,
    400,
  );
});

Deno.test("голос: без Content-Length или с нечисловым — 411 до чтения тела", async () => {
  const noLen = new Request("http://x/tasks/voice", {
    method: "POST",
    body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([1])), c.close()) }),
    headers: { "content-type": "multipart/form-data; boundary=x" },
    // @ts-ignore duplex нужен для потокового тела
    duplex: "half",
  });
  assertEquals(await code(await handleBoardRoutes(ctx(), noLen, "/tasks/voice")), [411, "length_required"]);
  const junk = await voiceReq(new File(["a"], "a.m4a", { type: "audio/mp4" }), { "content-length": "abc" });
  assertEquals(await code(await handleBoardRoutes(ctx(), junk, "/tasks/voice")), [411, "length_required"]);
});

/** Заглушка клиента для /board/call: только workspaces.allowed_markets и calendar_series_country. */
function callSupabase(opts: { markets: string[] | null; label?: string | null; writes?: unknown[] }) {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.delete = () => (opts.writes?.push({ delete: table }), q);
    q.upsert = (row: unknown) => (opts.writes?.push({ upsert: row }), Promise.resolve({ error: null }));
    q.maybeSingle = () =>
      Promise.resolve({
        data: table === "workspaces" ? { allowed_markets: opts.markets } : opts.label ? { country: opts.label } : null,
        error: null,
      });
    q.then = (res: (v: unknown) => unknown) => res({ error: null });
    return q;
  };
  return { from: chain } as unknown as SupabaseClient;
}

const callGet = (qs: string) => new Request(`http://x/board/call${qs}`);
const callPut = (body: unknown) => new Request("http://x/board/call", { method: "PUT", body: JSON.stringify(body) });

Deno.test("экран страны: демо закрыто, ключ обязателен, метод только GET/PUT", async () => {
  assertEquals(await code(await handleBoardRoutes(ctx({ isDemo: true }), callGet("?key=a"), "/board/call")), [
    403,
    "demo_not_allowed",
  ]);
  assertEquals(await code(await handleBoardRoutes(ctx(), callGet(""), "/board/call")), [400, "bad_key"]);
  assertEquals(await code(await handleBoardRoutes(ctx(), callGet("?key=%20"), "/board/call")), [400, "bad_key"]);
  assertEquals(await code(await handleBoardRoutes(ctx(), callPut({ country: "RS" }), "/board/call")), [
    400,
    "bad_key",
  ]);
  assertEquals(
    (await handleBoardRoutes(ctx(), new Request("http://x/board/call", { method: "POST" }), "/board/call"))!.status,
    405,
  );
});

Deno.test("экран страны: без метки — подсказка из названия и markets, задач нет", async () => {
  const supabase = callSupabase({ markets: ["RS", "SI"] });
  const res = await handleBoardRoutes(
    ctx({ supabase }),
    callGet(
      "?key=abc@google.com:2026-10-26&title=%D0%A1%D0%B8%D0%BD%D0%BA%20%D0%BF%D0%BE%20%D0%A1%D0%BB%D0%BE%D0%B2%D0%B5%D0%BD%D0%B8%D0%B8",
    ),
    "/board/call",
  );
  assertEquals(res!.status, 200);
  assertEquals(await res!.json(), {
    series_key: "abc@google.com",
    country: null,
    suggested: "SI",
    markets: ["RS", "SI"],
    tasks: [],
  });
});

Deno.test("экран страны PUT: страна вне markets и без поля — 400 bad_country, метка пишется только для своей страны", async () => {
  const writes: unknown[] = [];
  const supabase = callSupabase({ markets: ["RS"], label: "RS", writes });
  assertEquals(
    await code(
      await handleBoardRoutes(ctx({ supabase }), callPut({ key: "a:2026-10-26", country: "PL" }), "/board/call"),
    ),
    [
      400,
      "bad_country",
    ],
  );
  assertEquals(
    await code(await handleBoardRoutes(ctx({ supabase }), callPut({ key: "a:2026-10-26" }), "/board/call")),
    [
      400,
      "bad_country",
    ],
  );
  assertEquals(writes, []); // отказ — до записи
  // снятие метки: delete, ответ — вид без метки уже не нужен для проверки; важно, что запись ушла
  await handleBoardRoutes(
    ctx({ supabase: callSupabase({ markets: ["RS"], writes }) }),
    callPut({ key: "a:2026-10-26", country: null }),
    "/board/call",
  );
  assertEquals(writes, [{ delete: "calendar_series_country" }]);
});
