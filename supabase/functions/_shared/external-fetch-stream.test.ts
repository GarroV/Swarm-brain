import { assert, assertEquals } from "@std/assert";
import { externalFetch } from "./external-fetch.ts";
import { recordModelUsage } from "./model-usage.ts";

Deno.test("#864: usage collection does not hold the first streamed response until EOF", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const first = 'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"fixture"}}],"usage":null}\n\n';
  const last =
    'data: {"model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500}}\n\ndata: [DONE]\n\n';
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(first));
    },
  });
  let started!: () => void;
  const recordingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const rows: Record<string, unknown>[] = [];
  const scheduled: Promise<void>[] = [];
  let recording: Promise<void> | undefined;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "EdgeRuntime");
  Object.defineProperty(globalThis, "EdgeRuntime", {
    configurable: true,
    value: {
      waitUntil: (work: Promise<void>) => {
        scheduled.push(work);
      },
    },
  });
  try {
    const request = externalFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o-mini", stream: true }),
    }, {
      service: "openai",
      timeoutMs: 5000,
      fetchFn: () => Promise.resolve(new Response(stream, { headers: { "content-type": "text/event-stream" } })),
      usage: { purpose: "task-extract:long" },
      recordUsageFn: (url, init, res, label) => {
        recording = recordModelUsage(url, init, res, label, (row) => {
          rows.push(row);
          return Promise.resolve({ error: null });
        });
        started();
        return recording;
      },
    });
    await recordingStarted;
    let returned = false;
    request.then(() => {
      returned = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const returnedBeforeEnd = returned;
    controller.enqueue(encoder.encode(last));
    controller.close();
    const response = await request;
    assertEquals(await response.text(), first + last);
    await recording;
    await Promise.all(scheduled);
    assert(returnedBeforeEnd, "accounting buffered the entire model stream before returning the response");
    assertEquals(scheduled.length, 1, "Edge Runtime must retain the accounting task");
    assertEquals([rows.length, rows[0]?.prompt_tokens, rows[0]?.completion_tokens, rows[0]?.cost_usd], [
      1,
      1000,
      500,
      0.00045,
    ]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "EdgeRuntime", previous);
    else Reflect.deleteProperty(globalThis, "EdgeRuntime");
  }
});
