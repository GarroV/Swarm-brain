import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type ExtractionMetric, taskExtractionResponse } from "./task-extraction-response.ts";

const enc = new TextEncoder();
const frame = (content: string) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
const done = () => enc.encode("data: [DONE]\n\n");
const task = (title: string) => ({ title, description: null, assignee: null, due_date: null, country: null });
type Options = Parameters<typeof taskExtractionResponse>[1];
function options(extra: Partial<Options> = {}): Options {
  return {
    origin: "https://example.com",
    today: "2026-11-06",
    requestStream: () => Promise.reject(new Error("unexpected SSE call")),
    extractJson: () => Promise.reject(new Error("unexpected JSON call")),
    ...extra,
  };
}
function frames(text: string) {
  return text.split("\n\n").filter(Boolean).map((f) => JSON.parse(f.slice(6)));
}

Deno.test("production logger emits only the fixed metric schema, not task content", async () => {
  const lines: unknown[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(...args);
  };
  try {
    const res = await taskExtractionResponse(
      "json",
      options({
        now: () => 0,
        extractJson: () => Promise.resolve({ ok: true, tasks: [task("private customer details")] }),
      }),
    );
    await res.json();
    assertEquals(lines.length, 1);
    assertEquals(JSON.parse(String(lines[0])), {
      event: "task_extract",
      mode: "json",
      outcome: "done",
      task_count: 1,
      first_task_ms: null,
      total_ms: 0,
    });
  } finally {
    console.info = original;
  }
});

Deno.test("SSE: first task is observable before completion; timings include upstream wait", async () => {
  let clock = 0;
  const metrics: ExtractionMetric[] = [];
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        source = c;
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const res = await taskExtractionResponse(
    "sse",
    options({
      now: () => clock,
      log: (m) => metrics.push(m),
      requestStream: () => {
        clock = 25;
        return Promise.resolve(upstream);
      },
    }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("content-type")?.startsWith("text/event-stream"));
  assertEquals(res.headers.get("cache-control"), "no-cache, no-transform");
  assertEquals(res.headers.get("x-accel-buffering"), "no");
  const reader = res.body!.getReader();
  clock = 60;
  source.enqueue(frame('[{"title":"private task content"}'));
  const first = new TextDecoder().decode((await reader.read()).value);
  assertEquals(frames(first)[0].type, "task");
  assertEquals(metrics, []); // completion has not happened; response was not buffered
  clock = 100;
  source.enqueue(done());
  const rest = await reader.read();
  assertEquals(frames(new TextDecoder().decode(rest.value)), [{ type: "done", count: 1 }]);
  assertEquals(await reader.read(), { done: true, value: undefined });
  assert(cancelled);
  assertEquals(metrics, [{
    event: "task_extract",
    mode: "sse",
    outcome: "done",
    task_count: 1,
    first_task_ms: 60,
    total_ms: 100,
  }]);
});

Deno.test("JSON: count is what HTTP actually returns (legacy ten-task cap), no streaming TTFT", async () => {
  let clock = 0;
  const metrics: ExtractionMetric[] = [];
  const res = await taskExtractionResponse(
    "json",
    options({
      now: () => clock,
      log: (m) => metrics.push(m),
      extractJson: () => {
        clock = 75;
        return Promise.resolve({ ok: true, tasks: Array.from({ length: 12 }, (_, i) => task(`sensitive ${i}`)) });
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).length, 10);
  assertEquals(metrics, [{
    event: "task_extract",
    mode: "json",
    outcome: "done",
    task_count: 10,
    first_task_ms: null,
    total_ms: 75,
  }]);
});

Deno.test("JSON: valid empty result and malformed model answer have distinct fixed outcomes", async () => {
  const metrics: ExtractionMetric[] = [];
  for (const result of [{ ok: true, tasks: [] }, { ok: false, reason: "malformed" }] as const) {
    const res = await taskExtractionResponse(
      "json",
      options({
        now: () => 0,
        log: (m) => metrics.push(m),
        extractJson: () => Promise.resolve(result.ok ? { ok: true, tasks: [] } : result),
      }),
    );
    assertEquals(res.status, result.ok ? 200 : 502);
    await res.json();
  }
  assertEquals(metrics.map((m) => [m.mode, m.outcome, m.task_count, m.first_task_ms]), [
    ["json", "done", 0, null],
    ["json", "invalid_response", 0, null],
  ]);
});

Deno.test("SSE: upstream rejection before headers is measured and still returns 502", async () => {
  const metrics: ExtractionMetric[] = [];
  const res = await taskExtractionResponse(
    "sse",
    options({
      now: () => 0,
      log: (m) => metrics.push(m),
      requestStream: () => Promise.resolve(new Response("untrusted provider body", { status: 503 })),
    }),
  );
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Extractor unavailable" });
  assertEquals(metrics, [{
    event: "task_extract",
    mode: "sse",
    outcome: "upstream_error",
    task_count: 0,
    first_task_ms: null,
    total_ms: 0,
  }]);
});

Deno.test("SSE: malformed content emits existing error frame and invalid_response metric", async () => {
  const metrics: ExtractionMetric[] = [];
  const res = await taskExtractionResponse(
    "sse",
    options({
      now: () => 0,
      log: (m) => metrics.push(m),
      requestStream: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(frame("not valid JSON"));
                c.enqueue(done());
                c.close();
              },
            }),
          ),
        ),
    }),
  );
  assertEquals(frames(await res.text()), [{ type: "error", message: "Ответ модели не удалось разобрать" }]);
  assertEquals(metrics[0]?.outcome, "invalid_response");
  assertEquals(metrics[0]?.first_task_ms, null);
});

Deno.test("SSE: failure after first task preserves count/timing and never logs exception content", async () => {
  let clock = 0;
  const metrics: ExtractionMetric[] = [];
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const res = await taskExtractionResponse(
    "sse",
    options({
      now: () => clock,
      log: (m) => metrics.push(m),
      requestStream: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                source = c;
              },
            }),
          ),
        ),
    }),
  );
  const reader = res.body!.getReader();
  clock = 20;
  source.enqueue(frame('[{"title":"private task"}'));
  assertEquals(frames(new TextDecoder().decode((await reader.read()).value))[0].type, "task");
  clock = 45;
  source.error(new Error("raw error with private content"));
  assertEquals(frames(new TextDecoder().decode((await reader.read()).value))[0].type, "error");
  await reader.read();
  assertEquals(metrics, [{
    event: "task_extract",
    mode: "sse",
    outcome: "stream_error",
    task_count: 1,
    first_task_ms: 20,
    total_ms: 45,
  }]);
  assert(!JSON.stringify(metrics).includes("private"));
});

Deno.test("SSE: existing twenty-task cap counts emitted tasks and releases upstream", async () => {
  const metrics: ExtractionMetric[] = [];
  let cancelled = false;
  const res = await taskExtractionResponse(
    "sse",
    options({
      now: () => 0,
      log: (m) => metrics.push(m),
      requestStream: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(frame(JSON.stringify(Array.from({ length: 21 }, (_, i) => task(`task ${i}`)))));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        ),
    }),
  );
  const out = frames(await res.text());
  assertEquals(out.filter((f) => f.type === "task").length, 20);
  assertEquals(out.at(-1), { type: "done", count: 20 });
  assert(cancelled);
  assertEquals(metrics[0]?.task_count, 20);
});

Deno.test("transport throws are measured without changing upstream exception propagation", async () => {
  for (const mode of ["json", "sse"] as const) {
    const metrics: ExtractionMetric[] = [];
    const fail = () => Promise.reject(new Error("untrusted provider details"));
    await assertRejects(
      () =>
        taskExtractionResponse(
          mode,
          options({
            now: () => 0,
            log: (m) => metrics.push(m),
            requestStream: fail,
            extractJson: fail,
          }),
        ),
      Error,
      "untrusted provider details",
    );
    assertEquals(metrics, [{
      event: "task_extract",
      mode,
      outcome: "upstream_error",
      task_count: 0,
      first_task_ms: null,
      total_ms: 0,
    }]);
  }
});
