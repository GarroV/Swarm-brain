import { assertEquals } from "jsr:@std/assert@1";
import { canAccessDraftMeeting, draftMeetingsOwnScoped } from "./meeting-access.ts";

// Черновик на вычитке — это сырая запись чужого разговора: полный транскрипт, ещё не вычитанный
// и не опубликованный автором. Решение владельца 2026-08-20: видит ТОЛЬКО тот, кто записал —
// админ тоже нет. До этого админ открывал чужой черновик целиком (проверено на проде: 834
// сегмента живого разговора коллеги) и мог его опубликовать за автора.
// Пригляд «у кого копится вычитка» остаётся у админа агрегатом без контента —
// GET /admin/review-counts.

const RECORDER = 111;
const OTHER = 222;
const ADMIN = 744230399;

const draft = { group_id: "cee", recorders: [{ telegram_id: RECORDER }] };

Deno.test("записавший видит свой черновик", () => {
  assertEquals(canAccessDraftMeeting(draft, RECORDER, false, "cee"), true);
});

Deno.test("АДМИН НЕ видит чужой черновик — оверсайта здесь нет", () => {
  assertEquals(canAccessDraftMeeting(draft, ADMIN, true, "cee"), false);
});

Deno.test("участник того же воркспейса не видит чужой черновик", () => {
  assertEquals(canAccessDraftMeeting(draft, OTHER, false, "cee"), false);
});

Deno.test("встречу писали двое — видит каждый из них", () => {
  const shared = { group_id: "cee", recorders: [{ telegram_id: RECORDER }, { telegram_id: OTHER }] };
  assertEquals(canAccessDraftMeeting(shared, RECORDER, false, "cee"), true);
  assertEquals(canAccessDraftMeeting(shared, OTHER, false, "cee"), true);
  assertEquals(canAccessDraftMeeting(shared, ADMIN, true, "cee"), false);
});

Deno.test("чужой воркспейс закрыт даже записавшему (перенос/смена воркспейса)", () => {
  assertEquals(canAccessDraftMeeting(draft, RECORDER, false, "other"), false);
});

Deno.test("нет записи или пустые recorders — доступа нет ни у кого (fail-closed)", () => {
  assertEquals(canAccessDraftMeeting(null, ADMIN, true, "cee"), false);
  assertEquals(canAccessDraftMeeting({ group_id: "cee", recorders: [] }, ADMIN, true, "cee"), false);
  assertEquals(canAccessDraftMeeting({ group_id: "cee", recorders: undefined }, RECORDER, false, "cee"), false);
});

Deno.test("список очереди own-scoped ВСЕГДА, флага «показать все» больше нет", () => {
  // Сигнатура намеренно без параметров isAdmin/showAll: раньше ветка `all=true && isAdmin`
  // отдавала админу весь воркспейс. Если её вернут — этот тест придётся осознанно править.
  assertEquals(draftMeetingsOwnScoped.length, 1);
  assertEquals(JSON.stringify(draftMeetingsOwnScoped(555)), JSON.stringify([{ telegram_id: 555 }]));
});
