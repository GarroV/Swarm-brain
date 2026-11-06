import { assertEquals } from "@std/assert";
import { recordModelUsage } from "./model-usage.ts";
import { extractRequestBody } from "./task-extract.ts";

const url = "https://api.openai.com/v1/chat/completions";
const init = { body: JSON.stringify({ model: "gpt-4o-mini", stream: true }) };
const usage = {
  prompt_tokens: 1000,
  completion_tokens: 500,
  prompt_tokens_details: { cached_tokens: 200 },
  completion_tokens_details: { reasoning_tokens: 20 },
};
const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;

async function logged(response: Response) {
  const rows: Record<string, unknown>[] = [];
  await recordModelUsage(url, init, response, { purpose: "task-extract:long", groupId: "fixture" }, (row) => {
    rows.push(row);
    return Promise.resolve({ error: null });
  });
  assertEquals(rows.length, 1);
  return rows[0];
}

Deno.test("#864: streaming extractor requests final usage; JSON extractor does not", () => {
  const streamed = JSON.parse(extractRequestBody("fixture", "2026-11-06", true));
  assertEquals(streamed.stream_options, { include_usage: true });
  assertEquals(JSON.parse(extractRequestBody("fixture", "2026-11-06", false)).stream_options, undefined);
});

Deno.test("#864: final SSE usage records counts/cost without consuming the original response", async () => {
  const wire = frame({ model: "gpt-4o-mini-2024-07-18", choices: [{ delta: { content: "fixture" } }], usage: null }) +
    frame({ model: "gpt-4o-mini-2024-07-18", choices: [], usage }) + "data: [DONE]\n\n";
  const response = new Response(wire, { headers: { "content-type": "text/event-stream" } });
  const row = await logged(response);
  assertEquals([row.prompt_tokens, row.completion_tokens, row.reasoning_tokens, row.cost_usd], [
    1000,
    500,
    20,
    0.000435,
  ]);
  assertEquals([row.model, row.purpose, row.group_id], ["gpt-4o-mini-2024-07-18", "task-extract:long", "fixture"]);
  assertEquals(await response.text(), wire);
});

Deno.test("#864: fragmented CRLF SSE keeps UTF-8 and reads final usage without a trailing blank line", async () => {
  const wire = (frame({ model: "gpt-4o-mini", choices: [{ delta: { content: "выдуманный текст" } }], usage: null }) +
    `data: ${JSON.stringify({ model: "gpt-4o-mini", choices: [], usage })}`).replaceAll("\n", "\r\n");
  const bytes = new TextEncoder().encode(wire);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
  const response = new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  assertEquals((await logged(response)).prompt_tokens, 1000);
  assertEquals(await response.text(), wire);
});

Deno.test("#864: interrupted stream without usage stays unknown, never zero", async () => {
  const response = new Response(
    frame({ model: "gpt-4o-mini", choices: [{ delta: { content: "fixture" } }], usage: null }),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
  const row = await logged(response);
  assertEquals([row.prompt_tokens, row.completion_tokens, row.cost_usd], [null, null, null]);
  await response.text();
});

Deno.test("#864: ordinary JSON usage remains recorded", async () => {
  const response = Response.json({ model: "gpt-4o-mini", usage });
  assertEquals((await logged(response)).cost_usd, 0.000435);
  assertEquals((await response.json()).usage.prompt_tokens, 1000);
});
