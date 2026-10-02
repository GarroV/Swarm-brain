import { assertEquals } from "jsr:@std/assert@1";
import {
  canAccessDraftMeeting,
  canDeleteDraftMeeting,
  draftMeetingsOwnScopedFilter,
  hasCoOwners,
  oneOnOnePartner,
} from "./meeting-access.ts";

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
  assertEquals(draftMeetingsOwnScopedFilter.length, 1);
  assertEquals(
    draftMeetingsOwnScopedFilter(555),
    'recorders.cs.[{"telegram_id":555}],co_owners.cs.{555}',
  );
});

// Совладельцы (решение владельца 2026-09-25, п. 26–27): участник встречи с аккаунтом SWARM.
const coOwned = { group_id: "cee", recorders: [{ telegram_id: RECORDER }], co_owners: [OTHER] };

Deno.test("совладелец (участник встречи из SWARM) видит черновик, посторонний и админ — нет", () => {
  assertEquals(canAccessDraftMeeting(coOwned, OTHER, false, "cee"), true);
  assertEquals(canAccessDraftMeeting(coOwned, 333, false, "cee"), false);
  assertEquals(canAccessDraftMeeting(coOwned, ADMIN, true, "cee"), false);
  assertEquals(canAccessDraftMeeting(coOwned, OTHER, false, "other"), false);
});

Deno.test("удалить черновик может только записавший, совладелец — нет", () => {
  assertEquals(canDeleteDraftMeeting(coOwned, RECORDER), true);
  assertEquals(canDeleteDraftMeeting(coOwned, OTHER), false);
  assertEquals(canDeleteDraftMeeting(null, RECORDER), false);
});

Deno.test("несколько владельцев: совладельцы или двое записавших", () => {
  assertEquals(hasCoOwners(draft), false);
  assertEquals(hasCoOwners(coOwned), true);
  assertEquals(hasCoOwners({ recorders: [{ telegram_id: 1 }, { telegram_id: 2 }] }), true);
  assertEquals(hasCoOwners({ recorders: [{ telegram_id: 1 }, { telegram_id: 1 }], co_owners: [] }), false);
});

// ── Встреча 1-1: личная публикация для обоих (#641, решение владельца 30.09.2026) ──────────
// «если встреча проходила только с двумя живыми участниками (боты не в счет) - то появляется
// выбор сохранения в личные пространства двух участников».
// Люди = владельцы черновика (записавшие ∪ совладельцы) плюс люди из календаря без SWARM.
// Отрицательный id — НЕ мусор: это веб-пользователь без Telegram (вход по e-mail), живой человек.

const A = 900000101;
const B = -37;

Deno.test("1-1: двое владельцев, двое в календаре — партнёр найден", () => {
  const m = {
    recorders: [{ telegram_id: A }],
    co_owners: [B],
    attendees: [{ email: "a@x.io" }, { email: "b@x.io" }],
  };
  assertEquals(oneOnOnePartner(m, A), B);
  assertEquals(oneOnOnePartner(m, B), A);
});

Deno.test("1-1: веб-пользователь с отрицательным id считается человеком", () => {
  // Регресс-страж: «-38 игнорировать» превратило бы встречу трёх человек в 1-1.
  const m = { recorders: [{ telegram_id: A }], co_owners: [-38, 744230399] };
  assertEquals(oneOnOnePartner(m, A), null);
});

Deno.test("1-1: третий человек в календаре без SWARM — это уже не 1-1", () => {
  const m = {
    recorders: [{ telegram_id: A }],
    co_owners: [B],
    attendees: [{ email: "a@x.io" }, { email: "b@x.io" }, { email: "c@x.io" }],
  };
  assertEquals(oneOnOnePartner(m, A), null);
});

Deno.test("1-1: переговорка и дубль адреса в календаре людьми не считаются", () => {
  const m = {
    recorders: [{ telegram_id: A }],
    co_owners: [B],
    attendees: [
      { email: "a@x.io" },
      { email: "B@x.io" },
      { email: "b@x.io " },
      { email: "room-3@resource.calendar.google.com" },
      { email: "hall@x.io", resource: true },
    ],
  };
  assertEquals(oneOnOnePartner(m, A), B);
});

Deno.test("1-1: двое записавших одну встречу без совладельцев — тоже 1-1", () => {
  const m = { recorders: [{ telegram_id: A }, { telegram_id: B }], co_owners: [] };
  assertEquals(oneOnOnePartner(m, A), B);
});

Deno.test("1-1: один владелец — партнёра нет (это просто своя встреча)", () => {
  assertEquals(oneOnOnePartner({ recorders: [{ telegram_id: A }] }, A), null);
});

Deno.test("1-1: посторонний не получает партнёра, даже если встреча 1-1", () => {
  const m = { recorders: [{ telegram_id: A }], co_owners: [B] };
  assertEquals(oneOnOnePartner(m, 999), null);
});

Deno.test("1-1: трое владельцев — нет", () => {
  const m = { recorders: [{ telegram_id: A }], co_owners: [B, 555] };
  assertEquals(oneOnOnePartner(m, A), null);
});

Deno.test("1-1: id приходят строками (bigint из базы) — считаются как числа", () => {
  const m = { recorders: [{ telegram_id: A }], co_owners: [String(B)] as unknown as number[] };
  assertEquals(oneOnOnePartner(m, A), B);
});
