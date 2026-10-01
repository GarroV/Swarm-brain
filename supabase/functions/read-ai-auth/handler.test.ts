// read-ai-auth: выключатель, проверка state и экранирование страницы ответа.
// Read.ai не используется, поэтому по умолчанию функция отвечает отказом на любой путь.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { escapeHtml, handleReadAiAuth, type ReadAiAuthDeps, STATE_TTL_MS, type StateRow } from "./handler.ts";

type Row = Record<string, unknown>;

function fakeDeps(over: Partial<ReadAiAuthDeps> = {}, stateRow: StateRow | null = null) {
  const calls: { upserts: Row[]; deletes: string[]; fetches: string[] } = { upserts: [], deletes: [], fetches: [] };
  const deps: ReadAiAuthDeps = {
    enabled: true,
    clientId: "client-1",
    redirectUri: "https://example.test/functions/v1/read-ai-auth",
    now: () => 1_000_000_000_000,
    store: {
      getClientId: () => Promise.resolve(null),
      saveClientId: () => Promise.resolve(),
      saveState: (row) => {
        calls.upserts.push(row);
        return Promise.resolve();
      },
      takeState: (state) => {
        calls.deletes.push(state);
        return Promise.resolve(stateRow);
      },
      saveToken: (row) => {
        calls.upserts.push(row);
        return Promise.resolve();
      },
    },
    fetch: (input) => {
      calls.fetches.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 }));
    },
    ...over,
  };
  return { deps, calls };
}

const req = (qs: string) => new Request(`https://example.test/functions/v1/read-ai-auth${qs}`);

Deno.test("выключено по умолчанию: старт отвечает отказом и ничего не пишет", async () => {
  const { deps, calls } = fakeDeps({ enabled: false });
  const res = await handleReadAiAuth(req("?start=1"), deps);
  assertEquals(res.status, 403);
  assertEquals(calls.upserts.length, 0);
  assertEquals(calls.fetches.length, 0);
});

Deno.test("выключено: колбэк с кодом не обменивается и токен не пишется", async () => {
  const { deps, calls } = fakeDeps({ enabled: false }, { client_id: "c", code_verifier: "v", created_at: null });
  const res = await handleReadAiAuth(req("?code=x&state=y"), deps);
  assertEquals(res.status, 403);
  assertEquals(calls.upserts.length, 0);
  assertEquals(calls.deletes.length, 0);
  assertEquals(calls.fetches.length, 0);
});

Deno.test("выключено: параметр error не попадает в ответ", async () => {
  const { deps } = fakeDeps({ enabled: false });
  const res = await handleReadAiAuth(req("?error=%3Cscript%3Ex%3C%2Fscript%3E"), deps);
  assertEquals(res.status, 403);
  const body = await res.text();
  assert(!body.includes("<script>"));
});

Deno.test("включено: параметр error экранируется", async () => {
  const { deps } = fakeDeps();
  const res = await handleReadAiAuth(req("?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E"), deps);
  const body = await res.text();
  assert(!body.includes("<script>alert(1)</script>"), "сырой тег в ответе");
  assertStringIncludes(body, "&lt;script&gt;alert(1)&lt;/script&gt;");
});

Deno.test("включено: неизвестный state — отказ без обмена кода", async () => {
  const { deps, calls } = fakeDeps({}, null);
  const res = await handleReadAiAuth(req("?code=x&state=nope"), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.fetches.length, 0);
  assertEquals(calls.upserts.length, 0);
});

Deno.test("включено: просроченный state — отказ без обмена кода", async () => {
  const now = 1_000_000_000_000;
  const old = new Date(now - STATE_TTL_MS - 1000).toISOString();
  const { deps, calls } = fakeDeps({ now: () => now }, { client_id: "c", code_verifier: "v", created_at: old });
  const res = await handleReadAiAuth(req("?code=x&state=s"), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.fetches.length, 0);
  assertEquals(calls.upserts.length, 0);
});

Deno.test("включено: state без времени создания — отказ", async () => {
  const { deps, calls } = fakeDeps({}, { client_id: "c", code_verifier: "v", created_at: null });
  const res = await handleReadAiAuth(req("?code=x&state=s"), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.fetches.length, 0);
});

Deno.test("включено: свежий state — одноразовый, токен сохраняется", async () => {
  const now = 1_000_000_000_000;
  const fresh = new Date(now - 1000).toISOString();
  const { deps, calls } = fakeDeps({ now: () => now }, { client_id: "c", code_verifier: "v", created_at: fresh });
  const res = await handleReadAiAuth(req("?code=x&state=s"), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.deletes, ["s"]);
  assertEquals(calls.fetches.length, 1);
  assertEquals(calls.upserts.length, 1);
});

Deno.test("включено: ответ Read.ai об ошибке токена экранируется", async () => {
  const now = 1_000_000_000_000;
  const fresh = new Date(now - 1000).toISOString();
  const { deps } = fakeDeps({
    now: () => now,
    fetch: () => Promise.resolve(new Response(JSON.stringify({ error: "<img src=x onerror=1>" }), { status: 400 })),
  }, { client_id: "c", code_verifier: "v", created_at: fresh });
  const body = await (await handleReadAiAuth(req("?code=x&state=s"), deps)).text();
  assert(!body.includes("<img"), "сырой тег в ответе");
});

Deno.test("escapeHtml экранирует все пять опасных символов", () => {
  assertEquals(
    escapeHtml(`<a href="x" title='y'>&</a>`),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
  );
});
