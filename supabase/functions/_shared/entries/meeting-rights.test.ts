// Права на встречу-запись: кто правит и кто удаляет (решение владельца 30.09.2026,
// docs/decisions/2026-09-30-audit-fixes-scope.md).
//
// Матрица «роль × действие × видимость». Тесты написаны так, чтобы падать на ЧУЖОМ: пропуск
// постороннего должен валить прогон, а не только отказ своему.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  canActOnMeeting,
  canChangeMeetingPrivacy,
  isMeetingParticipant,
  meetingAccessError,
  type MeetingAction,
  type MeetingRightsRow,
  type MeetingViewer,
} from "./meeting-rights.ts";

const OWNER = 111;
const PARTICIPANT = 222;
const ADMIN = 333;
const OUTSIDER = 444;

const attendees = [
  { name: "Owner", email: "owner@example.com" },
  { name: "Participant", email: "participant@example.com" },
];

const shared: MeetingRightsRow = {
  is_private: false,
  owner_id: OWNER,
  group_id: "cee",
  metadata: { attendees },
};
const privateMeeting: MeetingRightsRow = { ...shared, is_private: true };
const unowned: MeetingRightsRow = { ...shared, owner_id: null };

const owner: MeetingViewer = { id: OWNER, email: "owner@example.com" };
// Регистр и пробелы в e-mail пользователя не должны влиять на причастность.
const participant: MeetingViewer = { id: PARTICIPANT, email: "  Participant@Example.com " };
const admin: MeetingViewer = { id: ADMIN, email: "admin@example.com", isAdmin: true };
const outsider: MeetingViewer = { id: OUTSIDER, email: "outsider@example.com" };

type Row = [string, MeetingViewer, MeetingAction, boolean];

// ── Общая встреча ────────────────────────────────────────────────────────────
const sharedMatrix: Row[] = [
  ["владелец", owner, "view", true],
  ["владелец", owner, "edit", true],
  ["владелец", owner, "delete", true],
  ["участник", participant, "view", true],
  ["участник", participant, "edit", true],
  ["участник", participant, "delete", false],
  ["админ", admin, "view", true],
  ["админ", admin, "edit", true],
  ["админ", admin, "delete", true],
  ["посторонний", outsider, "view", true],
  ["посторонний", outsider, "edit", false],
  ["посторонний", outsider, "delete", false],
];
for (const [who, viewer, action, expected] of sharedMatrix) {
  Deno.test(`общая встреча: ${who} × ${action} → ${expected ? "можно" : "нельзя"}`, () => {
    assertEquals(canActOnMeeting(shared, viewer, action), expected);
  });
}

// ── Личная встреча: только владелец, без обхода для админа и участников ──────
const privateMatrix: Row[] = [
  ["владелец", owner, "view", true],
  ["владелец", owner, "edit", true],
  ["владелец", owner, "delete", true],
  ["участник", participant, "view", false],
  ["участник", participant, "edit", false],
  ["участник", participant, "delete", false],
  ["админ", admin, "view", false],
  ["админ", admin, "edit", false],
  ["админ", admin, "delete", false],
  ["посторонний", outsider, "view", false],
  ["посторонний", outsider, "edit", false],
  ["посторонний", outsider, "delete", false],
];
for (const [who, viewer, action, expected] of privateMatrix) {
  Deno.test(`личная встреча: ${who} × ${action} → ${expected ? "можно" : "нельзя"}`, () => {
    assertEquals(canActOnMeeting(privateMeeting, viewer, action), expected);
  });
}

// ── Встреча без владельца ────────────────────────────────────────────────────
Deno.test("встреча без владельца: участник правит, но не удаляет; админ может всё", () => {
  assertEquals(canActOnMeeting(unowned, participant, "edit"), true);
  assertEquals(canActOnMeeting(unowned, participant, "delete"), false);
  assertEquals(canActOnMeeting(unowned, admin, "delete"), true);
  assertEquals(canActOnMeeting(unowned, outsider, "edit"), false);
});

Deno.test("пустой id зрителя не совпадает с пустым владельцем", () => {
  assertEquals(canActOnMeeting(unowned, { id: null }, "edit"), false);
  assertEquals(canActOnMeeting(unowned, { id: null }, "delete"), false);
});

// ── Причастность по e-mail ───────────────────────────────────────────────────
Deno.test("причастность: без e-mail у зрителя — не участник (fail-closed)", () => {
  assertEquals(isMeetingParticipant(shared, null), false);
  assertEquals(isMeetingParticipant(shared, ""), false);
  assertEquals(canActOnMeeting(shared, { id: PARTICIPANT }, "edit"), false);
});

Deno.test("причастность: участники не списком или без e-mail — никто не участник", () => {
  const broken: MeetingRightsRow = { ...shared, metadata: { attendees: "participant@example.com" } };
  assertEquals(isMeetingParticipant(broken, "participant@example.com"), false);
  const noEmail: MeetingRightsRow = { ...shared, metadata: { attendees: [{ name: "Participant" }] } };
  assertEquals(isMeetingParticipant(noEmail, "participant@example.com"), false);
  const noMeta: MeetingRightsRow = { ...shared, metadata: null };
  assertEquals(isMeetingParticipant(noMeta, "participant@example.com"), false);
});

Deno.test("причастность: e-mail в участниках сравнивается без регистра", () => {
  const upper: MeetingRightsRow = {
    ...shared,
    metadata: { attendees: [{ email: "PARTICIPANT@example.com" }] },
  };
  assertEquals(isMeetingParticipant(upper, "participant@example.com"), true);
});

// ── Текст отказа ─────────────────────────────────────────────────────────────
Deno.test("отказ по невидимой встрече неотличим от «не найдена»", () => {
  const denied = meetingAccessError("m-1", privateMeeting, admin, "cee", "edit");
  assertEquals(denied, meetingAccessError("m-1", null, admin, "cee", "edit"));
  assertNotEquals(denied, null);
});

Deno.test("чужой воркспейс — «не найдена», даже для админа", () => {
  const other = { ...shared, group_id: "other" };
  const denied = meetingAccessError("m-2", other, admin, "cee", "delete");
  assertEquals(denied, meetingAccessError("m-2", null, admin, "cee", "delete"));
});

Deno.test("отказ по видимой встрече назван прямо и отличается от «не найдена»", () => {
  const denied = meetingAccessError("m-3", shared, participant, "cee", "delete");
  assertNotEquals(denied, null);
  assertNotEquals(denied, meetingAccessError("m-3", null, participant, "cee", "delete"));
});

Deno.test("разрешённое действие — null", () => {
  assertEquals(meetingAccessError("m-4", shared, participant, "cee", "edit"), null);
  assertEquals(meetingAccessError("m-4", shared, admin, "cee", "delete"), null);
});

// ── Смена видимости ──────────────────────────────────────────────────────────
Deno.test("видимость общей встречи меняют владелец и админ, но не участник и не посторонний", () => {
  assertEquals(canChangeMeetingPrivacy(shared, owner), true);
  assertEquals(canChangeMeetingPrivacy(shared, admin), true);
  assertEquals(canChangeMeetingPrivacy(shared, participant), false);
  assertEquals(canChangeMeetingPrivacy(shared, outsider), false);
});

Deno.test("видимость личной встречи меняет только владелец", () => {
  assertEquals(canChangeMeetingPrivacy(privateMeeting, owner), true);
  assertEquals(canChangeMeetingPrivacy(privateMeeting, admin), false);
});

// ── Личная встреча 1-1 на двоих (#641) ───────────────────────────────────────────────────────
// Второй участник видит и правит (он такой же участник разговора), но не удаляет и не меняет
// видимость: удаление и смена видимости остаются за владельцем записи. Админа здесь нет.
const PARTNER_ID = 555;
const oneOnOne: MeetingRightsRow = { ...privateMeeting, shared_with: [PARTNER_ID] };
const partner: MeetingViewer = { id: PARTNER_ID, email: "partner@example.com" };

Deno.test("1-1 на двоих: партнёр видит и правит", () => {
  assertEquals(canActOnMeeting(oneOnOne, partner, "view"), true);
  assertEquals(canActOnMeeting(oneOnOne, partner, "edit"), true);
});

Deno.test("1-1 на двоих: партнёр не удаляет и не меняет видимость", () => {
  assertEquals(canActOnMeeting(oneOnOne, partner, "delete"), false);
  assertEquals(canChangeMeetingPrivacy(oneOnOne, partner), false);
  assertNotEquals(meetingAccessError("m1", oneOnOne, partner, "cee", "delete"), null);
});

Deno.test("1-1 на двоих: владелец может всё", () => {
  for (const a of ["view", "edit", "delete"] as MeetingAction[]) {
    assertEquals(canActOnMeeting(oneOnOne, owner, a), true);
  }
});

Deno.test("1-1 на двоих: участник воркспейса, админ и даже участник по календарю не видят", () => {
  for (const v of [outsider, admin, participant]) {
    for (const a of ["view", "edit", "delete"] as MeetingAction[]) {
      assertEquals(canActOnMeeting(oneOnOne, v, a), false);
    }
    assertEquals(meetingAccessError("m1", oneOnOne, v, "cee", "view"), "Встреча m1 не найдена.");
  }
});

Deno.test("1-1 на двоих: партнёр из чужого воркспейса не видит", () => {
  assertEquals(meetingAccessError("m1", oneOnOne, partner, "other", "view"), "Встреча m1 не найдена.");
});
