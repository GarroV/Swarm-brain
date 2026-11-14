// Смоук эндпоинта целиком: работает НАСТОЯЩИЙ index.ts, подменены только сеть (fetch) и
// Deno.serve. Проверяет порядок проверок вокруг необязательного поля `speakers`: разбор таймлайна
// идёт ПОСЛЕ проверки владения встречей. Иначе держатель чужого токена получал бы 400 про
// содержимое поля вместо 403/404 и платил бы разбором за чужую или несуществующую встречу.
// Юнит-тесты speakers.test.ts этого доказать не могут: порядок живёт в обработчике, а не в модуле.
//
// Встреча «своя» стоит с notes_edited_at — обработчик отвечает skipped_human_edit, не дойдя до
// записи и транскрибации. Любой пишущий запрос наружу смоук роняет: в этих сценариях его быть не должно.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_SPEAKER_TIMELINE_CHARS } from "../_shared/speakers.ts";
import { m4aOf } from "./m4a-fixture.ts";

const TOKEN = "smcp_stub-token";
const TOKEN_HASH = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))),
).map((b) => b.toString(16).padStart(2, "0")).join("");

const OWNER = 42;
const MEETINGS: Record<string, Record<string, unknown>> = {
  "m-mine": { id: "m-mine", claim_owner: OWNER, notes_edited_at: "2026-09-01T00:00:00Z", summary_status: null },
  // Готовая встреча с записью этого же человека (стенограмма до 425 с) — повтор выгрузки или новая запись (#1271).
  "m-done": {
    id: "m-done",
    claim_owner: OWNER,
    notes_edited_at: null,
    summary_status: "done",
    sources: ["person:42"],
    first_segment: { start: 0, end: 3, text: "привет" },
    transcript: { segments: [{ start: 0, end: 3, text: "привет" }, { start: 400, end: 425, text: "пока" }] },
  },
  // Та же запись, пока её первая выгрузка ещё обрабатывается: стенограммы нет, длина принятой — 425 с (#1318).
  "m-processing": {
    id: "m-processing",
    claim_owner: OWNER,
    notes_edited_at: null,
    summary_status: "processing",
    sources: ["person:42"],
    first_segment: null,
    recorded_seconds: 425,
  },
  "m-other": { id: "m-other", claim_owner: 777, notes_edited_at: null, summary_status: null },
};

const respond = (req: Request, row: unknown) => {
  // maybeSingle просит объект заголовком Accept; на всякий случай отвечаем и массивом.
  const wantsObject = (req.headers.get("Accept") ?? "").includes("vnd.pgrst.object");
  if (wantsObject && row === null) {
    return Promise.resolve(Response.json({ code: "PGRST116", message: "0 rows" }, { status: 406 }));
  }
  return Promise.resolve(Response.json(wantsObject ? row : row === null ? [] : [row]));
};

const realFetch = globalThis.fetch;
const stubFetch = ((input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (req.method !== "GET") throw new Error(`смоук не ждал записи: ${req.method} ${url.pathname}`);
  if (url.pathname.endsWith("/rest/v1/allowed_users")) {
    const hit = url.search.includes(TOKEN_HASH);
    return respond(
      req,
      hit
        ? {
          telegram_id: OWNER,
          group_id: "cee",
          claude_mcp_token_hash: TOKEN_HASH,
          claude_mcp_token_expires_at: null,
          recorder_token_hash: null,
          recorder_token_expires_at: null,
          recorder_token_prev_hash: null,
          recorder_token_prev_expires_at: null,
        }
        : null,
    );
  }
  if (url.pathname.endsWith("/rest/v1/service_agents")) return respond(req, null);
  if (url.pathname.endsWith("/rest/v1/meetings")) {
    const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
    return respond(req, MEETINGS[id] ?? null);
  }
  throw new Error(`смоук не ждал запроса наружу: ${url.href}`);
}) as typeof fetch;

// Прежние значения запоминаются и возвращаются, а не стираются: тесты базы (*.db.test.ts) идут в
// том же процессе и берут настоящие доступы контура из этих же переменных (scripts/with-local-db).
const envBefore = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((k) => [k, Deno.env.get(k)] as const);
Deno.env.set("SUPABASE_URL", "https://stub.supabase.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
// deno-lint-ignore no-explicit-any
const denoAny = Deno as any;
const realServe = denoAny.serve;
denoAny.serve = (h: Handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref: () => {}, unref: () => {} };
};
await import("./index.ts");
denoAny.serve = realServe;
for (const [k, v] of envBefore) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);

async function call(
  meetingId: string,
  speakers?: string,
  token: string | null = TOKEN,
  backupOnly = false,
  audioSeconds?: number,
): Promise<{ status: number; error?: string; summary_status?: string }> {
  const form = new FormData();
  if (audioSeconds !== undefined) {
    form.set("sys_parts", JSON.stringify([{ name: "sys0", offset: 0 }]));
    form.set("sys0", new File([m4aOf(audioSeconds)], "sys0.m4a", { type: "audio/m4a" }));
  }
  form.set("meeting_id", meetingId);
  if (backupOnly) form.set("backup_only", "1");
  if (speakers !== undefined) form.set("speakers", speakers);
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  globalThis.fetch = stubFetch;
  try {
    const res = await handler!(
      new Request("https://stub.invalid/meeting-ingest", { method: "POST", headers, body: form }),
    );
    return { status: res.status, ...(await res.json()) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const GARBAGE = "not json";
const HUGE = "[" + "x".repeat(MAX_SPEAKER_TIMELINE_CHARS);

Deno.test("meeting-ingest: чужая встреча с мусорным speakers → 403, а не 400 про поле", async () => {
  const r = await call("m-other", GARBAGE);
  assertEquals(r.status, 403, `разбор speakers обогнал проверку владения: ${r.error}`);
});

Deno.test("meeting-ingest: чужая встреча с огромным speakers → 403, потолок не раскрывается чужому", async () => {
  const r = await call("m-other", HUGE);
  assertEquals(r.status, 403, `разбор speakers обогнал проверку владения: ${r.error}`);
});

Deno.test("meeting-ingest: несуществующая встреча с мусорным speakers → 404", async () => {
  const r = await call("m-none", GARBAGE);
  assertEquals(r.status, 404, `разбор speakers обогнал поиск встречи: ${r.error}`);
});

Deno.test("meeting-ingest: своя встреча с мусорным speakers → 400 с внятной причиной", async () => {
  const r = await call("m-mine", GARBAGE);
  assertEquals(r.status, 400);
  assertStringIncludes(r.error ?? "", "speakers: invalid JSON");
});

Deno.test("meeting-ingest: своя встреча с огромным speakers → 400 про размер, до разбора", async () => {
  const r = await call("m-mine", HUGE);
  assertEquals(r.status, 400);
  assertStringIncludes(r.error ?? "", "too large");
});

Deno.test("meeting-ingest: своя встреча с валидным speakers и без него — запрос проходит как раньше", async () => {
  const withSpeakers = await call("m-mine", '[{"start":0,"end":3,"name":"Анна"}]');
  assertEquals([withSpeakers.status, withSpeakers.summary_status], [200, "skipped_human_edit"]);
  const withoutSpeakers = await call("m-mine");
  assertEquals([withoutSpeakers.status, withoutSpeakers.summary_status], [200, "skipped_human_edit"]);
});

// Серверный бэкап (#1070): ветка backup_only стоит сразу после проверки участника.
Deno.test("meeting-ingest backup_only: чужая встреча → 403, несуществующая → 404, записей наружу нет", async () => {
  assertEquals((await call("m-other", undefined, TOKEN, true)).status, 403);
  assertEquals((await call("m-none", undefined, TOKEN, true)).status, 404);
});

Deno.test("meeting-ingest backup_only: замороженная встреча идёт в бэкап, а не отвечает skipped_human_edit", async () => {
  // m-mine правлена человеком: обычная выгрузка получила бы 200 skipped_human_edit. Бэкап принимается
  // и доходит до разбора частей — без аудио отвечает 400 про аудио, а не пропуском.
  const r = await call("m-mine", undefined, TOKEN, true);
  assertEquals(r.status, 400);
  assertStringIncludes(r.error ?? "", "audio required");
});

// #1271: ответ already_processed на НОВУЮ запись того же человека терял её молча. Запись наружу смоук
// роняет, поэтому принятая в работу выгрузка упирается в хранилище — 500 «failed to store audio»;
// 200 already_processed — это и есть выброс.
Deno.test("meeting-ingest: повтор выгрузки к готовой встрече — already_processed", async () => {
  const r = await call("m-done", undefined, TOKEN, false, 430);
  assertEquals([r.status, r.summary_status], [200, "already_processed"]);
});

Deno.test("meeting-ingest: новая длинная запись того же человека к готовой встрече — не выбрасывается (#1271)", async () => {
  const r = await call("m-done", undefined, TOKEN, false, 1500);
  assertEquals(r.summary_status === "already_processed", false, "новая запись принята за повтор и потеряна");
  assertEquals(r.status, 500);
  assertStringIncludes(r.error ?? "", "failed to store audio");
});

// #1318: то же для встречи в обработке. Очередь пишет в хранилище — смоук его роняет (500), а 200
// already_processed — потеря записи.
Deno.test("meeting-ingest: повтор выгрузки, пока она обрабатывается, — already_processed", async () => {
  const r = await call("m-processing", undefined, TOKEN, false, 430);
  assertEquals([r.status, r.summary_status], [200, "already_processed"]);
});

Deno.test("meeting-ingest: новая длинная запись того же человека, пока первая обрабатывается, — не выбрасывается (#1318)", async () => {
  const r = await call("m-processing", undefined, TOKEN, false, 1500);
  assertEquals(r.summary_status === "already_processed", false, "новая запись принята за повтор и потеряна");
  assertEquals(r.status, 500);
  assertStringIncludes(r.error ?? "", "failed to store audio");
});
