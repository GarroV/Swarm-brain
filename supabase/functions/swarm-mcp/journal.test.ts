import { assertEquals } from "jsr:@std/assert@1";
import { isMutatingTool, type JournalRow, recordToolCall, tokenHint } from "./journal.ts";

function fakeSink(fail = false) {
  const rows: JournalRow[] = [];
  return {
    rows,
    from: (table: string) => ({
      insert: (row: JournalRow) => {
        rows.push({ ...row, table } as JournalRow);
        return Promise.resolve({ error: fail ? { message: "boom" } : null });
      },
    }),
  };
}

const HASH = "a".repeat(58) + "123456";

Deno.test("изменяющий вызов пишется строкой без аргументов и без токена", async () => {
  const sink = fakeSink();
  const wrote = await recordToolCall(sink, { telegramId: 111, tool: "add_task", outcome: "ok", tokenHash: HASH });
  assertEquals(wrote, true);
  assertEquals(sink.rows, [
    { telegram_id: 111, tool: "add_task", outcome: "ok", token_hint: "123456", table: "mcp_tool_journal" } as never,
  ]);
  assertEquals(Object.keys(sink.rows[0]).sort(), ["outcome", "table", "telegram_id", "token_hint", "tool"]);
});

Deno.test("чтение и незнакомые инструменты в журнал не идут, write и destructive — идут", async () => {
  assertEquals(isMutatingTool("get_tasks"), false);
  assertEquals(isMutatingTool("whoami"), false);
  assertEquals(isMutatingTool("no_such_tool"), false);
  assertEquals(isMutatingTool("add_task"), true);
  assertEquals(isMutatingTool("delete_task"), true);
  const sink = fakeSink();
  assertEquals(await recordToolCall(sink, { telegramId: 1, tool: "get_tasks", outcome: "ok", tokenHash: HASH }), false);
  assertEquals(sink.rows.length, 0);
});

Deno.test("отказ и ошибка тоже пишутся", async () => {
  const sink = fakeSink();
  await recordToolCall(sink, { telegramId: 1, tool: "delete_task", outcome: "refused", tokenHash: null });
  await recordToolCall(sink, { telegramId: 1, tool: "delete_task", outcome: "error", tokenHash: HASH });
  assertEquals(sink.rows.map((r) => r.outcome), ["refused", "error"]);
  assertEquals(sink.rows[0].token_hint, null);
});

Deno.test("сбой журнала не бросает исключение, а возвращает false", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    assertEquals(
      await recordToolCall(fakeSink(true), { telegramId: 1, tool: "add_task", outcome: "ok", tokenHash: HASH }),
      false,
    );
  } finally {
    console.error = original;
  }
});

Deno.test("tokenHint — только хвост хэша", () => {
  assertEquals(tokenHint(HASH), "123456");
  assertEquals(tokenHint(null), null);
});
