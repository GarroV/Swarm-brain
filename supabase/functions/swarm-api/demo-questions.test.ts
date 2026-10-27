// Демо без модели (docs/decisions/2026-10-27-demo-no-model.md): демо-сессия не делает НИ ОДНОГО
// обращения к OpenAI. Проверка не по коду «вроде не зовёт», а по счётчику: подмена globalThis.fetch
// считает вызовы, и каждый маршрут, который зовёт модель, обязан отвечать при нуле.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { externalFetch, VIA_OPENAI_CHAT } from "../_shared/external-fetch.ts";
import { blockModelCalls, ModelBlockedError, withModelScope } from "../_shared/model-scope.ts";
import { embed, extractEntryMeta } from "../_shared/meta-extract.ts";
import { classifyDemoModelRoute, findDemoQuestion, handleDemoModelRoute } from "./demo-questions.ts";
import { DEMO_DIGEST, DEMO_QUESTIONS } from "./demo-questions-data.ts";

const HERE = fromFileUrl(new URL(".", import.meta.url));
const BASE = "https://x.test/functions/v1/swarm-api";

/** Подмена fetch: считает любые обращения и не отпускает их наружу. */
async function withFetchSpy<T>(fn: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return Promise.reject(new Error("сеть в тесте закрыта"));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Минимальный supabase: цепочка фильтров, await отдаёт заранее заданные строки. */
function fakeSupabase(rows: Array<{ id: string }>) {
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  return { from: () => builder } as any;
}

/** Все маршруты, которые зовут модель (разбор index.ts и модулей swarm-api, 27.10.2026). */
const MODEL_ROUTES: Array<[method: string, path: string, action: string]> = [
  ["POST", "/ask", "ask"],
  ["GET", "/search", "search"],
  ["POST", "/digest", "digest"],
  ["POST", "/entries", "refuse"],
  ["POST", "/tasks/extract", "refuse"],
  ["POST", "/tasks/voice", "refuse"],
  ["POST", "/meetings/abc/ask", "refuse"],
  ["POST", "/agent-meetings/abc/ask", "refuse"],
  ["POST", "/meetings/abc/resummarize", "refuse"],
  ["POST", "/agent-meetings/abc/resummarize", "refuse"],
  ["POST", "/meetings/record", "refuse"],
  ["PUT", "/meetings/record/abc/segments/1", "refuse"],
  ["POST", "/meetings/record/abc/finish", "refuse"],
  ["GET", "/granola/notes/abc/preview", "refuse"],
  ["POST", "/granola/notes/abc/import", "refuse"],
];

Deno.test("классификатор: каждый маршрут к модели узнаётся, соседние обычные — нет", () => {
  for (const [method, path, action] of MODEL_ROUTES) {
    assertEquals(classifyDemoModelRoute(method, path), action, `${method} ${path}`);
  }
  for (const [method, path] of [["GET", "/tasks"], ["POST", "/agent-meetings/abc/publish"], ["GET", "/meetings"], ["GET", "/search/quick"], ["GET", "/meetings/record/active"], ["PATCH", "/entries/abc"]]) {
    assertEquals(classifyDemoModelRoute(method, path), null, `${method} ${path}`);
  }
});

Deno.test("демо: на каждом маршруте к модели — ноль обращений к сети и осмысленный ответ", async () => {
  const seeded = DEMO_QUESTIONS[0].sources.map((s) => ({ id: s.id }));
  await withFetchSpy(async (calls) => {
    for (const [method, path, action] of MODEL_ROUTES) {
      const url = `${BASE}${path}${path === "/search" ? "?q=" + encodeURIComponent(DEMO_QUESTIONS[0].question.en) : ""}`;
      const init: RequestInit = { method };
      if (method === "POST") init.body = JSON.stringify({ q: DEMO_QUESTIONS[0].question.en, text: "x" });
      const res = await withModelScope(async () => {
        blockModelCalls();
        return await handleDemoModelRoute({ supabase: fakeSupabase(seeded), origin: "" }, new Request(url, init), path);
      });
      assert(res, `${method} ${path}: демо-обработчик обязан ответить`);
      if (action === "refuse") {
        assertEquals(res.status, 403, `${method} ${path}`);
        const body = await res.json();
        assertEquals(body.code, "demo_model_unavailable");
        assert(body.error && body.error_ru, "отказ на двух языках");
      } else {
        assertEquals(res.status, 200, `${method} ${path}`);
      }
    }
    assertEquals(calls, [], `демо дошло до сети: ${calls.join(", ")}`);
  });
});

Deno.test("демо /ask: заготовленный вопрос → ответ и источники; чужой текст → подсказка без модели", async () => {
  const ask = (body: unknown) =>
    handleDemoModelRoute({ supabase: fakeSupabase([]), origin: "" }, new Request(`${BASE}/ask`, { method: "POST", body: JSON.stringify(body) }), "/ask")
      .then((r) => r!.json());
  const hit = await ask({ q: "what was decided about the app release" });
  assertEquals(hit.query, DEMO_QUESTIONS[0].question.en);
  assertEquals(hit.sources[0].id, "d0000000-0000-4000-8000-000000000502");
  assert(hit.answer.includes("[1]"));
  const byId = await ask({ id: "peak-hour" });
  assertEquals(byId.sources.length, 2);
  const miss = await ask({ q: "tell me a joke" });
  assertEquals(miss.sources, []);
  assertEquals(miss.followups.length, DEMO_QUESTIONS.length);
  assertEquals(findDemoQuestion("   "), null);
});

Deno.test("замок: externalFetch к OpenAI в демо-запросе не доходит до сети; вне демо — работает", async () => {
  await withFetchSpy(async (calls) => {
    await withModelScope(async () => {
      blockModelCalls();
      await assertRejects(
        () => externalFetch("https://api.openai.com/v1/embeddings", { method: "POST", body: "{}" }, VIA_OPENAI_CHAT),
        ModelBlockedError,
        "model call blocked",
      );
      // Обёртки, глотающие ошибки модели, тоже ничего не отправляют.
      assertEquals(await embed("текст", "sk-test"), null);
      assertEquals((await extractEntryMeta("текст", "sk-test")).countries, []);
    });
    assertEquals(calls, []);
    // Контроль: без замка тот же вызов доходит до подменённой сети — замок не «залипает».
    await withModelScope(async () => {
      await externalFetch("https://api.openai.com/v1/embeddings", { method: "POST", body: "{}" }, VIA_OPENAI_CHAT).catch(() => {});
    });
    assertEquals(calls.length, 1, "без замка вызов обязан дойти до fetch");
  });
});

Deno.test("замок: blockModelCalls вне withModelScope — ошибка, а не тихий пропуск", () => {
  let threw = false;
  try {
    blockModelCalls();
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("роутер: замок и демо-обработчик стоят до первого маршрута к модели", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  assert(/withModelScope\(\(\) => withErrorBoundary\(req, routeRequest\)\)/.test(src), "Deno.serve обязан идти через withModelScope");
  const flag = src.indexOf("if (isDemo) {\n    DEMO_REQUESTS.add(req);");
  assert(flag > 0 && src.slice(flag, flag + 400).includes("blockModelCalls()"), "замок встаёт сразу после опознания демо");
  const gate = src.indexOf("handleDemoModelRoute({ supabase, origin }, req, routePath)");
  assert(gate > flag, "демо-обработчик подключён");
  for (const marker of ['routePath === "/search"', 'routePath === "/ask"', 'routePath === "/digest"', 'routePath === "/tasks/extract"', 'routePath === "/entries"']) {
    const at = src.indexOf(marker);
    assert(at > gate, `${marker} стоит раньше демо-обработчика`);
  }
  assert(src.includes("skipModel: isDemo"), "публикация черновика в демо — без модели");
  assert(src.includes("draftNotes && !isDemo"), "подсказка рынков в демо — без модели");
});

Deno.test("каталог: id и заголовки записей — те же, что в сиде demo_reset; сноски сходятся", async () => {
  const seed = await Deno.readTextFile(`${HERE}../../migrations/20260928180000_demo_auto_reset.sql`);
  const ids = new Set(DEMO_QUESTIONS.map((q) => q.id));
  for (const q of DEMO_QUESTIONS) {
    for (const f of q.followups) assert(ids.has(f), `${q.id}: нет вопроса-продолжения ${f}`);
    for (const lang of ["en", "ru"] as const) {
      const cited = new Set([...q.answer[lang].matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
      assertEquals([...cited].sort(), q.sources.map((_, i) => i + 1), `${q.id}/${lang}: сноски и источники расходятся`);
    }
  }
  const sources = [...DEMO_QUESTIONS.flatMap((q) => q.sources), ...DEMO_DIGEST.sources];
  for (const s of sources) {
    assert(seed.includes(`'${s.id}'`), `запись ${s.id} (${s.title}) пропала из сида`);
    assert(seed.includes(`'title', '${s.title}'`), `заголовок «${s.title}» не совпал с сидом`);
    assert(seed.includes(`current_date - ${s.daysAgo},`), `дата записи «${s.title}» разошлась с сидом (${s.daysAgo})`);
  }
});
