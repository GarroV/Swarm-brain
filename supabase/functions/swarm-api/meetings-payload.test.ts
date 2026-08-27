import { assertEquals } from "jsr:@std/assert@1";
import { LIST_PREVIEW_CHARS, toAgentListRow, toListRow } from "./meetings-payload.ts";

Deno.test("toListRow режет content и summary и честно помечает truncated", () => {
  const row = { id: "a", content: "x".repeat(50_000), summary: "y".repeat(9_000), metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content.length, LIST_PREVIEW_CHARS);
  assertEquals(out.summary!.length, LIST_PREVIEW_CHARS);
  assertEquals(out.truncated, true);
});

Deno.test("первая строка content выживает — из неё строится заголовок встреч без metadata.title", () => {
  const row = { id: "a", content: "Знакомство с новым БД УК\n" + "тело ".repeat(20_000), summary: null, metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content.split("\n")[0], "Знакомство с новым БД УК");
});

Deno.test("короткие значения не трогаем и truncated не ставим", () => {
  const row = { id: "a", content: "Планёрка", summary: "Кратко", metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content, "Планёрка");
  assertEquals(out.summary, "Кратко");
  assertEquals(out.truncated, undefined);
});

Deno.test("summary = null остаётся null, а не превращается в строку", () => {
  const out = toListRow({ id: "a", content: "x".repeat(50_000), summary: null, metadata: {} });
  assertEquals(out.summary, null);
});

Deno.test("остальные поля проходят насквозь без изменений", () => {
  const row = { id: "a", content: "c", summary: "s", metadata: { title: "T" }, countries: ["RS"], is_private: false };
  const out = toListRow(row) as Record<string, unknown>;
  assertEquals(out.metadata, { title: "T" });
  assertEquals(out.countries, ["RS"]);
  assertEquals(out.is_private, false);
});

// ── toAgentListRow (GET /agent-meetings — списочный) ──────────────────────────

Deno.test("toAgentListRow убирает draft_notes_md и оставляет признак наличия", () => {
  const out = toAgentListRow({ id: "a", title: "Планёрка", draft_notes_md: "### Тезисы\n…" });
  assertEquals("draft_notes_md" in out, false);
  assertEquals(out.has_draft_notes, true);
});

Deno.test("тезисы ещё не готовы — признак false, а не отсутствие поля", () => {
  const out = toAgentListRow({ id: "a", title: "Планёрка", draft_notes_md: null });
  assertEquals(out.has_draft_notes, false);
});

Deno.test("пустая строка тезисов = НЕ готово (иначе список врёт «готово» на пустышке)", () => {
  assertEquals(toAgentListRow({ id: "a", draft_notes_md: "   " }).has_draft_notes, false);
});

Deno.test("остальные поля черновика проходят насквозь", () => {
  const row = { id: "a", title: "T", status: "awaiting_review", recorders: [{ telegram_id: 1 }], draft_notes_md: "x" };
  const out = toAgentListRow(row) as Record<string, unknown>;
  assertEquals(out.title, "T");
  assertEquals(out.status, "awaiting_review");
  assertEquals(out.recorders, [{ telegram_id: 1 }]);
});
