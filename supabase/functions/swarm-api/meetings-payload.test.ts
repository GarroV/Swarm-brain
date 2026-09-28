import { assertEquals } from "jsr:@std/assert@1";
import {
  LIST_PREVIEW_CHARS,
  toAgentListRow,
  toListRow,
} from "./meetings-payload.ts";

Deno.test("toListRow режет content и summary и честно помечает truncated", () => {
  const row = {
    id: "a",
    content: "x".repeat(50_000),
    summary: "y".repeat(9_000),
    metadata: {},
  };
  const out = toListRow(row);
  assertEquals(out.content.length, LIST_PREVIEW_CHARS);
  assertEquals(out.summary!.length, LIST_PREVIEW_CHARS);
  assertEquals(out.truncated, true);
});

Deno.test("первая строка content выживает — из неё строится заголовок встреч без metadata.title", () => {
  const row = {
    id: "a",
    content: "Знакомство с новым БД УК\n" + "тело ".repeat(20_000),
    summary: null,
    metadata: {},
  };
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
  const out = toListRow({
    id: "a",
    content: "x".repeat(50_000),
    summary: null,
    metadata: {},
  });
  assertEquals(out.summary, null);
});

Deno.test("остальные поля проходят насквозь без изменений", () => {
  const row = {
    id: "a",
    content: "c",
    summary: "s",
    metadata: { title: "T" },
    countries: ["RS"],
    is_private: false,
  };
  const out = toListRow(row) as Record<string, unknown>;
  assertEquals(out.metadata, { title: "T" });
  assertEquals(out.countries, ["RS"]);
  assertEquals(out.is_private, false);
});

// ── toAgentListRow (GET /agent-meetings — списочный) ──────────────────────────

Deno.test("toAgentListRow убирает draft_notes_md и оставляет признак наличия", () => {
  const out = toAgentListRow({
    id: "a",
    title: "Планёрка",
    draft_notes_md: "### Тезисы\n…",
  });
  assertEquals("draft_notes_md" in out, false);
  assertEquals(out.has_draft_notes, true);
});

Deno.test("тезисы ещё не готовы — признак false, а не отсутствие поля", () => {
  const out = toAgentListRow({
    id: "a",
    title: "Планёрка",
    draft_notes_md: null,
  });
  assertEquals(out.has_draft_notes, false);
});

Deno.test("пустая строка тезисов = НЕ готово (иначе список врёт «готово» на пустышке)", () => {
  assertEquals(
    toAgentListRow({ id: "a", draft_notes_md: "   " }).has_draft_notes,
    false,
  );
});

Deno.test("остальные поля черновика проходят насквозь", () => {
  const row = {
    id: "a",
    title: "T",
    status: "awaiting_review",
    recorders: [{ telegram_id: 1 }],
    draft_notes_md: "x",
  };
  const out = toAgentListRow(row) as Record<string, unknown>;
  assertEquals(out.title, "T");
  assertEquals(out.status, "awaiting_review");
  assertEquals(out.recorders, [{ telegram_id: 1 }]);
});

// ── превью приходит из базы (issue #490) ─────────────────────────────────────
//
// Новый путь: SQL уже отдал обрезанные колонки и признак усечения. Проверяем, что форма
// ответа осталась ПРЕЖНЕЙ — клиент не должен заметить, что обрезка переехала.

Deno.test("превью из базы: служебный list_truncated наружу не уезжает", () => {
  const out = toListRow({
    id: "a",
    content: "x".repeat(LIST_PREVIEW_CHARS),
    summary: null,
    list_truncated: true,
    metadata: {},
  }) as Record<string, unknown>;
  assertEquals("list_truncated" in out, false);
  assertEquals(out.truncated, true);
});

Deno.test("превью из базы: truncated берётся от ИСХОДНОЙ длины, а не от обрезанной", () => {
  // Ровно тот случай, ради которого флаг и нужен: строка уже обрезана до 400, по её длине
  // усечения не видно — знает об этом только база. Без флага список показал бы кусок
  // транскрипта как полный текст.
  const out = toListRow({
    id: "a",
    content: "x".repeat(LIST_PREVIEW_CHARS),
    summary: "y".repeat(LIST_PREVIEW_CHARS),
    list_truncated: true,
    metadata: {},
  });
  assertEquals(out.content.length, LIST_PREVIEW_CHARS);
  assertEquals(out.truncated, true);
});

Deno.test("превью из базы: короткая запись не помечается усечённой", () => {
  const out = toListRow({
    id: "a",
    content: "Планёрка",
    summary: "Кратко",
    list_truncated: false,
    metadata: {},
  });
  assertEquals(out.truncated, undefined);
  assertEquals(out.content, "Планёрка");
});

Deno.test("страховка: полные колонки в обход ENTRY_LIST_COLUMNS всё равно режутся", () => {
  // Если новый эндпоинт забудет превью-колонки, ответ не должен стать десятимегабайтным.
  const out = toListRow({
    id: "a",
    content: "x".repeat(50_000),
    summary: null,
    metadata: {},
  });
  assertEquals(out.content.length, LIST_PREVIEW_CHARS);
  assertEquals(out.truncated, true);
});

Deno.test("toAgentListRow: признак из базы, текст в строке вообще не приходит", () => {
  const out = toAgentListRow({
    id: "a",
    title: "Планёрка",
    has_draft_notes: true,
  }) as Record<string, unknown>;
  assertEquals(out.has_draft_notes, true);
  assertEquals("draft_notes_md" in out, false);
});

Deno.test("toAgentListRow: has_draft_notes=false из базы — это НЕ «поля нет»", () => {
  const out = toAgentListRow({ id: "a", has_draft_notes: false });
  assertEquals(out.has_draft_notes, false);
});
