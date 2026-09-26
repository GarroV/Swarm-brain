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

const TOKEN = "smcp_stub-token";
const TOKEN_HASH = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))),
).map((b) => b.toString(16).padStart(2, "0")).join("");

const OWNER = 42;
const MEETINGS: Record<string, Record<string, unknown>> = {
  "m-mine": { id: "m-mine", claim_owner: OWNER, notes_edited_at: "2026-09-01T00:00:00Z", summary_status: null },
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
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

async function call(
  meetingId: string,
  speakers?: string,
  token: string | null = TOKEN,
): Promise<{ status: number; error?: string; summary_status?: string }> {
  const form = new FormData();
  form.set("meeting_id", meetingId);
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
