import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { formatDraftMeeting, formatProposedTasks, formatPublishOutcome, formatReviewQueue } from "./meetings-format.ts";

const row = { id: "m1", title: "Синк", started_at: "2026-09-25T10:30:00Z", source: "desktop-agent", draft_notes_md: "- тезис" };

Deno.test("formatReviewQueue: пустая очередь говорит словами", () => {
  assertStringIncludes(formatReviewQueue([], 0), "пуста");
});

Deno.test("formatReviewQueue: печатает id и готовность тезисов", () => {
  const out = formatReviewQueue([row, { ...row, id: "m2", draft_notes_md: null }], 2);
  assertStringIncludes(out, "id: m1");
  assertStringIncludes(out, "тезисы готовы");
  assertStringIncludes(out, "тезисы ещё не готовы");
});

Deno.test("formatReviewQueue: обрезанная выдача предупреждает", () => {
  assertStringIncludes(formatReviewQueue([row], 70), "Показаны 1 из 70");
});

Deno.test("formatReviewQueue: полная выдача не пугает предупреждением", () => {
  assertEquals(formatReviewQueue([row], 1).includes("⚠️"), false);
});

Deno.test("formatDraftMeeting: участники по имени, без имени — по почте", () => {
  const out = formatDraftMeeting({ ...row, status: "awaiting_review", attendees: [{ name: "Анна" }, { email: "b@x.io" }] });
  assertStringIncludes(out, "Участники: Анна, b@x.io");
  assertStringIncludes(out, "на вычитке");
});

Deno.test("formatPublishOutcome: склейка с базой — чья версия осталась", () => {
  assertStringIncludes(formatPublishOutcome({ id: "e1", duplicate: true, replaced: true }, 200), "заменила прежнюю");
  assertStringIncludes(formatPublishOutcome({ id: "e1", duplicate: true, replaced: false }, 200), "осталась прежняя");
});

Deno.test("formatPublishOutcome: новая запись — в какую базу", () => {
  assertStringIncludes(formatPublishOutcome({ id: "e1", is_private: false }, 201), "в базу команды");
  assertStringIncludes(formatPublishOutcome({ id: "e1", is_private: true }, 201), "в личную базу");
});

Deno.test("formatPublishOutcome: повторная публикация", () => {
  assertStringIncludes(formatPublishOutcome({ id: "e1" }, 200), "уже был опубликован");
});

Deno.test("formatProposedTasks: ненайденный исполнитель — на разбирающего, с исходным именем", () => {
  const out = formatProposedTasks([{ title: "Позвонить", assignee: "Петя", resolved_assignee: null }], "Vasiliy Garro");
  assertStringIncludes(out, "Исполнитель: Vasiliy Garro (в тезисах «Петя», в команде не нашёлся)");
  assertStringIncludes(out, "Ничего не создано");
});

Deno.test("formatProposedTasks: найденный исполнитель печатается как есть", () => {
  const out = formatProposedTasks([{ title: "Позвонить", assignee: "Аня", resolved_assignee: "Анна Иванова" }], "Vasiliy Garro");
  assertStringIncludes(out, "Исполнитель: Анна Иванова");
});

Deno.test("formatProposedTasks: пусто — словами", () => {
  assertStringIncludes(formatProposedTasks([], "x"), "не нашлось");
});
