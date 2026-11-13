import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  KnowledgeChunkError,
  knowledgeChunkMarker,
  type KnowledgeChunkRow,
  restoreKnowledgeGroup,
} from "./knowledge-chunks.ts";

function parts(original: string): KnowledgeChunkRow[] {
  const chunks = [];
  for (let pos = 0; pos < original.length; pos += 2800) chunks.push(original.slice(pos, pos + 3000));
  return chunks.map((content, i) => ({
    id: `part-${i + 1}`,
    content,
    summary: i === 0 ? "Summary fixture" : null,
    metadata: { chunk_group_id: "79000000-0000-4000-8000-000000000001", chunk: i + 1, total_chunks: chunks.length },
    added_by: "claude_desktop",
    source: "fixture-source",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    group_id: "fixture",
    visible_group_ids: ["fixture"],
    owner_id: null,
    is_private: false,
    shared_with: [],
    countries: ["PL"],
    entry_type: "note",
    entry_date: null,
  }));
}

const original = "START " + "abcdef".repeat(1100) + " END";

Deno.test("legacy MCP: exact original at chunk boundaries, including the short duplicate last piece", () => {
  for (const size of [3001, 5600, 5601, 5700, 5800, 8401]) {
    const text = ("abcdefg".repeat(1300)).slice(0, size);
    const rows = parts(text);
    const before = JSON.stringify(rows);
    const result = restoreKnowledgeGroup(rows[0], [...rows].reverse());
    assertEquals(result.content, text, String(size));
    assertEquals(result.head.id, "part-1");
    assertEquals(JSON.stringify(rows), before, "input rows were mutated");
  }
});

Deno.test("legacy MCP: overlap counts UTF-16 units, not Unicode characters or fuzzy similarity", () => {
  const text = "\u{1F600}".repeat(3000) + "END";
  const rows = parts(text);
  assertEquals(restoreKnowledgeGroup(rows[1], rows).content, text);
});

Deno.test("legacy MCP: incomplete and duplicate ordinals explicitly refuse reconstruction", () => {
  const rows = parts(original);
  assertThrows(() => restoreKnowledgeGroup(rows[0], rows.slice(0, -1)), KnowledgeChunkError, "incomplete");
  const duplicate = structuredClone(rows);
  duplicate[1].metadata!.chunk = 1;
  assertThrows(() => restoreKnowledgeGroup(rows[0], duplicate), KnowledgeChunkError, "incomplete");
});

Deno.test("legacy MCP: manually edited first content is never silently replaced or spliced", () => {
  const rows = parts(original);
  rows[0].content = "EDITED " + rows[0].content.slice(7);
  rows[0].updated_at = "2026-09-02T00:00:00Z";
  assertThrows(() => restoreKnowledgeGroup(rows[0], rows), KnowledgeChunkError, "modified");
});

Deno.test("legacy MCP: an overlap mismatch is refused instead of trimming similar-looking text", () => {
  const rows = parts(original);
  rows[1].content = "X" + rows[1].content.slice(1);
  assertThrows(() => restoreKnowledgeGroup(rows[0], rows), KnowledgeChunkError, "overlap");
});

Deno.test("legacy MCP: mixed group identity or metadata is refused", () => {
  for (const field of ["source", "group_id", "owner_id", "is_private", "countries"]) {
    const rows = parts(original);
    Object.assign(rows[1], { [field]: field === "is_private" ? true : field === "countries" ? ["EE"] : "DIFFERENT" });
    assertThrows(() => restoreKnowledgeGroup(rows[0], rows), KnowledgeChunkError, "mismatched_group");
  }
  const rows = parts(original);
  rows[1].metadata!.title = "User-provided title";
  assertThrows(() => restoreKnowledgeGroup(rows[0], rows), KnowledgeChunkError, "modified");
});

Deno.test("legacy MCP: marker detection leaves unrelated writers and ordinary chunk metadata alone", () => {
  const row = parts(original)[1];
  assertEquals(knowledgeChunkMarker({ ...row, added_by: "other_writer" }), null);
  assertEquals(knowledgeChunkMarker({ ...row, metadata: { chunk: 2, total_chunks: 3 } }), null);
  assertEquals(knowledgeChunkMarker({ ...row, metadata: { ...row.metadata, chunk_group_id: "not-a-uuid" } }), null);
  assertEquals(knowledgeChunkMarker({ ...row, metadata: {} }), null);
  assertThrows(
    () => knowledgeChunkMarker({ ...row, metadata: { ...row.metadata, chunk: "2" } }),
    KnowledgeChunkError,
    "invalid_metadata",
  );
});

Deno.test("legacy MCP: oversized or changed-between-reads groups fail explicitly", () => {
  const rows = parts(original);
  assertThrows(
    () => restoreKnowledgeGroup({ ...rows[0], metadata: { ...rows[0].metadata, total_chunks: 201 } }, rows),
    KnowledgeChunkError,
    "limit",
  );
  assertThrows(
    () => restoreKnowledgeGroup({ ...rows[0], content: "STALE" }, rows),
    KnowledgeChunkError,
    "modified",
  );
});
