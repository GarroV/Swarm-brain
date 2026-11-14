import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { addKnowledge, type KnowledgeDeps, type KnowledgeRow } from "./knowledge-add.ts";

function fixture(embedding: number[] | null = [0.25, 0.75]) {
  const rows: KnowledgeRow[] = [];
  const inputs: string[] = [];
  const deps: KnowledgeDeps = {
    callerScope: () => Promise.resolve({ userId: 790, groupId: "fixture" }),
    insertEntry: (row) => {
      rows.push(row);
      return Promise.resolve({ error: null });
    },
    embeddingOrNull: (_groupId, text) => {
      inputs.push(text);
      return Promise.resolve(embedding);
    },
    extractMeta: () => Promise.resolve({ countries: ["PL"], entry_type: "note", entry_date: null }),
    applyGeneralSentinel: (countries) => countries,
    noWorkspaceMessage: "NO_WORKSPACE",
    unindexedNote: "UNINDEXED_FIXTURE",
  };
  return { deps, rows, inputs };
}

Deno.test("add_knowledge: long original is exactly one complete entry", async () => {
  const f = fixture();
  const original = "  ORIGINAL START\n" + "abcdefghij".repeat(800) + "\nORIGINAL END  ";
  await addKnowledge({ content: original, summary: "Short summary", source: "fixture-source" }, f.deps);
  assertEquals(f.rows.length, 1);
  assertEquals(f.rows[0].content, original);
  assertEquals(f.rows[0].summary, "Short summary");
  assertEquals(f.rows[0].source, "fixture-source");
  assertEquals(f.rows[0].metadata, {});
  assertEquals(f.inputs, ["Short summary"]);
});

Deno.test("add_knowledge: even a short original retains its whitespace", async () => {
  const f = fixture();
  const original = "\n  original text  \n";
  await addKnowledge({ content: original, summary: "Summary" }, f.deps);
  assertEquals(f.rows[0].content, original);
});

Deno.test("add_knowledge: multibyte embedding input is bounded without clipping the original", async () => {
  const f = fixture();
  const summary = "\u{1F600}".repeat(5000);
  const original = "Full original " + summary;
  await addKnowledge({ content: original, summary }, f.deps);
  assert(new TextEncoder().encode(f.inputs[0]).length <= 8000);
  assertEquals(f.rows.length, 1);
  assertEquals(f.rows[0].content, original);
  assertEquals(f.rows[0].summary, summary);
  assertEquals(f.inputs.length, 1);
  assert(!f.inputs[0].includes("\uFFFD"));
});

Deno.test("add_knowledge: both destinations retain the caller as author", async () => {
  for (const is_private of [false, true]) {
    const f = fixture();
    await addKnowledge({ content: "Original", summary: "Summary", is_private, owner_telegram_id: 123 }, f.deps);
    assertEquals(f.rows[0].owner_id, 790);
    assertEquals(f.rows[0].group_id, "fixture");
    assertEquals(f.rows[0].is_private, is_private);
    assertEquals(f.rows[0].added_by, "claude_desktop");
  }
});

Deno.test("add_knowledge: absent or blank original keeps the existing summary fallback", async () => {
  for (const content of [undefined, "   "]) {
    const f = fixture();
    await addKnowledge({ content, summary: "Summary fallback" }, f.deps);
    assertEquals(f.rows.length, 1);
    assertEquals(f.rows[0].content, "Summary fallback");
  }
});

Deno.test("add_knowledge: a missing embedding still persists the full original with an explicit note", async () => {
  const f = fixture(null);
  const original = "Original ".repeat(1000);
  const result = await addKnowledge({ content: original, summary: "Summary" }, f.deps);
  assertEquals(f.rows.length, 1);
  assertEquals(f.rows[0].content, original);
  assertEquals(f.rows[0].embedding, null);
  assertStringIncludes(result, "UNINDEXED_FIXTURE");
});

Deno.test("add_knowledge: failed persistence does not report success", async () => {
  const f = fixture();
  f.deps.insertEntry = () => Promise.resolve({ error: { message: "fixture insert failed" } });
  const result = await addKnowledge({ content: "Original", summary: "Summary" }, f.deps);
  assertStringIncludes(result, "fixture insert failed");
  assertEquals(f.rows.length, 0);
});
