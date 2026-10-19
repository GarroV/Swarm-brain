// Причина, вписанная в спринте, становится комментарием в задаче — от имени человека, который её
// вписал (решение владельца 19.10.2026, п.6). Решает, нужен ли комментарий и каким будет текст.
// Ошибка здесь молчит двояко: лишний комментарий рассылает людям уведомление, которого никто не
// писал, а пропущенный оставляет причину внутри спринта, куда задачу никто не открывает.
import { assertEquals } from "@std/assert";
import { buildReasonComment, type ReasonChange } from "./sprint-reason-comment.ts";

const CYCLE = "Спринт 4 · 20.10 — 02.11";

function change(over: Partial<ReasonChange>): ReasonChange {
  return { field: "carry_reason", before: null, after: "ждём поставщика", checkStatus: null, ...over };
}

Deno.test("причина переноса: метка, имя спринта и текст человека", () => {
  assertEquals(
    buildReasonComment(change({}), CYCLE, "ru"),
    "Перенос (Спринт 4 · 20.10 — 02.11): ждём поставщика",
  );
});

Deno.test("заметка сверки: метка несёт статус", () => {
  assertEquals(
    buildReasonComment(change({ field: "check_note", checkStatus: "risk", after: "нет доступа" }), CYCLE, "ru"),
    "Сверка — риск (Спринт 4 · 20.10 — 02.11): нет доступа",
  );
  assertEquals(
    buildReasonComment(change({ field: "check_note", checkStatus: "problem", after: "нет доступа" }), CYCLE, "ru"),
    "Сверка — проблема (Спринт 4 · 20.10 — 02.11): нет доступа",
  );
});

Deno.test("заметка сверки без статуса — просто «Сверка»", () => {
  assertEquals(
    buildReasonComment(change({ field: "check_note", after: "заметка" }), CYCLE, "ru"),
    "Сверка (Спринт 4 · 20.10 — 02.11): заметка",
  );
});

Deno.test("язык автора: английская метка", () => {
  assertEquals(
    buildReasonComment(change({}), CYCLE, "en"),
    "Carry-over (Спринт 4 · 20.10 — 02.11): ждём поставщика",
  );
  assertEquals(
    buildReasonComment(change({ field: "check_note", checkStatus: "risk", after: "x" }), CYCLE, "en"),
    "Check — at risk (Спринт 4 · 20.10 — 02.11): x",
  );
});

Deno.test("пустой или стёртый текст комментария не рождает", () => {
  assertEquals(buildReasonComment(change({ after: null }), CYCLE, "ru"), null);
  assertEquals(buildReasonComment(change({ after: "" }), CYCLE, "ru"), null);
  assertEquals(buildReasonComment(change({ after: "   " }), CYCLE, "ru"), null);
});

Deno.test("текст не изменился — второй комментарий не нужен (и уведомление не дублируется)", () => {
  assertEquals(buildReasonComment(change({ before: "ждём поставщика", after: "ждём поставщика" }), CYCLE, "ru"), null);
  assertEquals(
    buildReasonComment(change({ before: "ждём поставщика  ", after: " ждём поставщика" }), CYCLE, "ru"),
    null,
  );
});

Deno.test("изменённый текст — новый комментарий", () => {
  assertEquals(
    buildReasonComment(change({ before: "старое", after: "новое" }), CYCLE, "ru"),
    "Перенос (Спринт 4 · 20.10 — 02.11): новое",
  );
});

Deno.test("текст берётся как есть, без редактирования, только обрезаются края", () => {
  assertEquals(
    buildReasonComment(change({ after: "  две\nстроки  " }), CYCLE, "ru"),
    "Перенос (Спринт 4 · 20.10 — 02.11): две\nстроки",
  );
});

Deno.test("слишком длинная причина обрезается под предел комментария, а не роняет сохранение", () => {
  const out = buildReasonComment(change({ after: "я".repeat(25_000) }), CYCLE, "ru")!;
  assertEquals(out.length <= 20_000, true);
});
