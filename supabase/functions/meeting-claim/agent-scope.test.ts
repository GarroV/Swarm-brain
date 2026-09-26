// Сужение полномочий служебного агента до состава встречи (решение D016, issue #371).
//
// Ядро прав доступа: ошибка здесь молчалива — приватная запись встаёт на человека, которого на
// звонке не было, и никто этого не видит. Поэтому каждая граница — отдельным тестом, и каждый
// проверен порчей.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import type { GEvent } from "../meeting-current/select.ts";
import type { InviteRow } from "../_shared/meeting-invite.ts";
import {
  AgentScopeError,
  calendarKeyOf,
  type CalendarSource,
  type InviteSource,
  keyShape,
  mayJoinExisting,
  resolveAgentScope,
} from "./agent-scope.ts";

const PERSON = 111;
const OTHER = 222;
const bot: AgentIdentity = { telegramId: PERSON, groupId: "ws", kind: "bot", agentId: "scriba" };
const recorder: AgentIdentity = { telegramId: PERSON, groupId: "ws", kind: "recorder" };

const standup: GEvent = {
  id: "ev1",
  iCalUID: "standup@google.com",
  start: { dateTime: "2026-09-25T10:00:00+02:00" },
  end: { dateTime: "2026-09-25T10:30:00+02:00" },
  attendees: [
    { email: "person@team.io", displayName: "Person", self: true },
    { email: "boss@team.io" },
    { displayName: "Room 5" },
  ],
};
const STANDUP_KEY = "standup@google.com:2026-09-25";
const FORGED = [{ email: "person@team.io" }, { email: "victim@team.io" }];

type Calls = { refresh: number[]; windows: Array<[string, string]> };

function source(
  opts: { refresh?: string | null; token?: "ok" | "dead" | "down"; events?: GEvent[] | null } = {},
): CalendarSource & { calls: Calls } {
  const calls: Calls = { refresh: [], windows: [] };
  return {
    calls,
    refreshToken: (id) => {
      calls.refresh.push(id);
      return Promise.resolve(opts.refresh === undefined ? "refresh" : opts.refresh);
    },
    accessToken: () => {
      const t = opts.token ?? "ok";
      return Promise.resolve(
        t === "ok" ? { ok: true, token: "access" } : { ok: false, deadGrant: t === "dead" },
      );
    },
    listEvents: (_token, min, max) => {
      calls.windows.push([min, max]);
      return Promise.resolve(opts.events === undefined ? [standup] : opts.events);
    },
  };
}

const calendarClaim = { identity_kind: "calendar", identity_key: STANDUP_KEY, attendees: FORGED };

async function refused(p: Promise<unknown>, status: number): Promise<string> {
  const e = await assertRejects(() => p, AgentScopeError);
  assertEquals(e.status, status, `ожидался отказ ${status}, пришёл ${e.status}: ${e.message}`);
  return e.message;
}

// ── Форма ключа ─────────────────────────────────────────────────────────────

Deno.test("ключ события собирается так же, как его отдаёт meeting-current", () => {
  assertEquals(calendarKeyOf(standup), STANDUP_KEY);
  assertEquals(calendarKeyOf({ ...standup, iCalUID: undefined }), "ev1:2026-09-25");
  assertEquals(calendarKeyOf({ ...standup, start: { date: "2026-09-25" } }), null);
});

Deno.test("собранный ключ распознаётся как календарный — сборка и keyShape не разошлись", () => {
  const events: GEvent[] = [
    standup,
    { ...standup, iCalUID: undefined },
    { ...standup, iCalUID: "abc123_R20260925T080000@google.com" },
    { ...standup, start: { dateTime: "2026-12-31T23:30:00-05:00" } },
  ];
  for (const ev of events) {
    const key = calendarKeyOf(ev);
    assertEquals(key === null ? null : keyShape(key), "calendar", `ключ ${key}`);
  }
});

Deno.test("форма ключа: календарь, комнаты рекордера (в т.ч. суженные датой), прочее", () => {
  assertEquals(keyShape(STANDUP_KEY), "calendar");
  assertEquals(keyShape("abc123_R20260925T080000@google.com:2026-09-25"), "calendar");
  assertEquals(keyShape("meet:abc-defg-hij"), "room");
  assertEquals(keyShape("meet:abc-defg-hij:2026-09-25"), "room");
  assertEquals(keyShape("kontur:team_room-1"), "room");
  assertEquals(keyShape("kontur:team_room-1:2026-09-25"), "room");
  assertEquals(keyShape("tg:12345"), "other");
  assertEquals(keyShape("6f1c2b1e-0000-4000-8000-000000000000"), "other");
  assertEquals(keyShape("meet:NOT A CODE"), "invalid");
  assertEquals(keyShape("kontur:"), "invalid");
  assertEquals(keyShape("kontur:a b:2026-09-25"), "invalid");
  assertEquals(keyShape("standup google:2026-09-25"), "invalid");
});

Deno.test("БЛОКИРУЮЩИЙ: агент не меняет тип встречи, чтобы уйти от сверки → 400", async () => {
  const cases = [
    { identity_kind: "room", identity_key: STANDUP_KEY }, // календарный ключ под видом комнаты
    { identity_kind: "manual", identity_key: STANDUP_KEY }, // …под видом ручной
    { identity_kind: "calendar", identity_key: "kontur:abc" }, // комната под видом календаря
    { identity_kind: "manual", identity_key: "meet:abc-defg-hij" }, // комната под видом ручной
    { identity_kind: "calendar", identity_key: "tg:1" }, // произвольный ключ под видом календаря
    { identity_kind: "room", identity_key: "tg:1" }, // …под видом комнаты
    { identity_kind: "room", identity_key: "kontur:a b" }, // комната недопустимой формы
  ];
  for (const body of cases) {
    const src = source();
    const msg = await refused(resolveAgentScope(src, bot, body), 400);
    assertEquals(src.calls.refresh, [], `до календаря не дошли: ${JSON.stringify(body)} (${msg})`);
  }
});

Deno.test("люди шлют ключи как раньше — форма ключа с них не спрашивается", async () => {
  for (const kind of ["recorder", "recorder_prev", "mcp"] as const) {
    const scope = await resolveAgentScope(source({ refresh: null }), { ...recorder, kind }, {
      identity_kind: "room",
      identity_key: STANDUP_KEY,
    });
    assertEquals(scope, null);
  }
});

// ── Календарная встреча: человек обязан её иметь в своём календаре ──────────

Deno.test("БЛОКИРУЮЩИЙ: агент не заводит календарную встречу на человека, у которого её нет", async () => {
  const src = source({ events: [{ ...standup, iCalUID: "someone-elses@google.com" }] });
  const msg = await refused(resolveAgentScope(src, bot, calendarClaim), 403);
  assertEquals(msg.includes("not a participant"), true, msg);
});

Deno.test("БЛОКИРУЮЩИЙ: та же встреча другого дня не засчитывается (повторяющаяся серия)", async () => {
  await refused(
    resolveAgentScope(source(), bot, { ...calendarClaim, identity_key: "standup@google.com:2026-09-26" }),
    403,
  );
});

Deno.test("агент проходит, когда встреча есть в календаре названного человека", async () => {
  const src = source();
  const scope = await resolveAgentScope(src, bot, calendarClaim);
  assertEquals(src.calls.refresh, [PERSON], "календарь смотрится ТОГО человека, за кого просят");
  const [[min, max]] = src.calls.windows;
  assertEquals(min <= "2026-09-25T00:00:00.000Z" && max >= "2026-09-26T00:00:00.000Z", true);
  assertEquals(scope?.calendarKeys.has(STANDUP_KEY), true);
});

Deno.test("БЛОКИРУЮЩИЙ: состав календарной встречи агента — из события Google, не из тела", async () => {
  const scope = await resolveAgentScope(source(), bot, calendarClaim);
  assertEquals(scope?.attendees, [
    { name: "Person", email: "person@team.io" },
    { name: null, email: "boss@team.io" },
    { name: "Room 5", email: null },
  ]);
});

Deno.test("БЛОКИРУЮЩИЙ: календарь человека не подключён → календарную встречу не заводим", async () => {
  const msg = await refused(resolveAgentScope(source({ refresh: null }), bot, calendarClaim), 403);
  assertEquals(msg.includes("manual"), true, `отказ должен звать на ручной путь: ${msg}`);
});

Deno.test("БЛОКИРУЮЩИЙ: календарь не отвечает → отказ, а не пропуск без сверки", async () => {
  for (const opts of [{ token: "dead" as const }, { token: "down" as const }, { events: null }]) {
    await refused(resolveAgentScope(source(opts), bot, calendarClaim), 503);
  }
});

// ── Комнатная и ручная встречи агента ───────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: состав комнатной встречи агента из тела не берётся", async () => {
  const scope = await resolveAgentScope(source(), bot, {
    identity_kind: "room",
    identity_key: "kontur:abc",
    started_at: "2026-09-25T08:00:00Z",
    attendees: FORGED,
  });
  assertEquals(scope?.attendees, []);
  assertEquals(scope?.calendarKeys.has(STANDUP_KEY), true, "календарь человека нужен для склейки");
});

Deno.test("комнатная встреча агента проходит и без календаря — сверки состава нет (D016)", async () => {
  for (const opts of [{ refresh: null }, { token: "down" as const }, { events: null }]) {
    const scope = await resolveAgentScope(source(opts), bot, {
      identity_kind: "room",
      identity_key: "kontur:abc",
      started_at: "2026-09-25T08:00:00Z",
    });
    assertEquals(scope?.calendarKeys.size, 0, "календаря нет — ни одна календарная встреча не открыта");
  }
});

// ── Ручная встреча агента — только по приглашению человека (D017) ──────────

const INVITE_LINK = "https://meet.google.com/abc-defg-hij";
const NOW_MS = Date.now();
const validInvite: InviteRow = {
  id: "inv-1",
  group_id: "ws",
  invited_by: PERSON,
  join_url: INVITE_LINK,
  platform: "meet",
  created_at: new Date(NOW_MS - 60_000).toISOString(),
  expires_at: new Date(NOW_MS + 600_000).toISOString(),
  taken_at: null,
  used_at: null,
  meeting_id: null,
};

function invites(row: InviteRow | null): InviteSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    find: (id) => {
      asked.push(id);
      return Promise.resolve(row && row.id === id ? row : null);
    },
  };
}

const manualClaim = {
  identity_kind: "manual",
  identity_key: "scriba:run-1",
  invite_id: "inv-1",
  join_url: `${INVITE_LINK}?hl=en`,
  attendees: FORGED,
};

Deno.test("ручная встреча агента по действующему приглашению — проходит, без похода в календарь", async () => {
  const src = source({ refresh: null });
  const scope = await resolveAgentScope(src, bot, manualClaim, invites(validInvite));
  assertEquals(src.calls.refresh, []);
  assertEquals(scope?.inviteId, "inv-1");
});

Deno.test("БЛОКИРУЮЩИЙ: состав ручной встречи агента из тела не берётся", async () => {
  const scope = await resolveAgentScope(source(), bot, manualClaim, invites(validInvite));
  assertEquals(scope?.attendees, [], "подсунутый состав не должен лечь в строку");
});

Deno.test("БЛОКИРУЮЩИЙ: агент без приглашения не заводит ручную встречу → 403", async () => {
  const { invite_id: _drop, ...noInvite } = manualClaim;
  await refused(resolveAgentScope(source(), bot, noInvite, invites(validInvite)), 403);
  // Источник приглашений не передан — отказ, а не пропуск.
  await refused(resolveAgentScope(source(), bot, manualClaim), 403);
  // Несуществующее приглашение.
  await refused(resolveAgentScope(source(), bot, { ...manualClaim, invite_id: "nope" }, invites(validInvite)), 403);
});

Deno.test("БЛОКИРУЮЩИЙ: чужое приглашение (другой человек, другой воркспейс) → 403", async () => {
  await refused(resolveAgentScope(source(), bot, manualClaim, invites({ ...validInvite, invited_by: OTHER })), 403);
  await refused(resolveAgentScope(source(), bot, manualClaim, invites({ ...validInvite, group_id: "other" })), 403);
});

Deno.test("БЛОКИРУЮЩИЙ: истёкшее или использованное приглашение → 403", async () => {
  const expired = { ...validInvite, expires_at: new Date(NOW_MS - 1000).toISOString() };
  await refused(resolveAgentScope(source(), bot, manualClaim, invites(expired)), 403);
  const used = { ...validInvite, used_at: new Date(NOW_MS - 1000).toISOString() };
  await refused(resolveAgentScope(source(), bot, manualClaim, invites(used)), 403);
});

Deno.test("БЛОКИРУЮЩИЙ: приглашение на одну ссылку, бот пришёл с другой → 403", async () => {
  const swapped = { ...manualClaim, join_url: "https://meet.google.com/zzz-zzzz-zzz" };
  await refused(resolveAgentScope(source(), bot, swapped, invites(validInvite)), 403);
  const { join_url: _drop, ...noLink } = manualClaim;
  await refused(resolveAgentScope(source(), bot, noLink, invites(validInvite)), 403);
});

Deno.test("люди заводят ручную встречу как раньше — приглашение с них не спрашивается", async () => {
  const inv = invites(null);
  const scope = await resolveAgentScope(source(), recorder, { identity_kind: "manual", identity_key: "tg:1" }, inv);
  assertEquals(scope, null);
  assertEquals(inv.asked, []);
});

// ── Присоединение к уже открытой встрече ────────────────────────────────────

const noCalendar = { attendees: [], calendarKeys: new Set<string>() };
const withStandup = { attendees: [], calendarKeys: new Set([STANDUP_KEY]) };

const theirRoom = {
  identity_key: "kontur:their:2026-09-25",
  claim_owner: OTHER,
  attendees: [{ name: "Other", email: "other@team.io" }, { email: "boss@team.io" }],
};
const theirCalendar = { ...theirRoom, identity_key: "their-sync@google.com:2026-09-25" };

Deno.test("БЛОКИРУЮЩИЙ: агент не присоединяется к чужой комнате, где человека нет в составе", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", theirRoom, noCalendar), false);
  assertEquals(mayJoinExisting(bot, null, theirRoom, noCalendar), false, "без почты сверить нечем — отказ");
});

Deno.test("БЛОКИРУЮЩИЙ: к календарной встрече — только если она в календаре человека", () => {
  // Почта в составе строки не спасает: состав могли прислать, календарь — нет.
  const listed = { ...theirCalendar, attendees: [{ email: "person@team.io" }] };
  assertEquals(mayJoinExisting(bot, "person@team.io", listed, withStandup), false);
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirCalendar, attendees: [] }, withStandup), false);
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirCalendar, attendees: null }, noCalendar), false);
});

Deno.test("агент присоединяется к календарной встрече из календаря своего человека", () => {
  assertEquals(
    mayJoinExisting(bot, "x@y.z", { ...theirCalendar, identity_key: STANDUP_KEY, attendees: [] }, withStandup),
    true,
  );
});

Deno.test("агент присоединяется к комнате, если человек в составе (регистр почты не важен)", () => {
  assertEquals(
    mayJoinExisting(bot, " Person@Team.io ", {
      ...theirRoom,
      attendees: [...theirRoom.attendees, { email: "person@team.IO" }],
    }, noCalendar),
    true,
  );
});

Deno.test("агент присоединяется к встрече, которую уже держит тот же человек", () => {
  assertEquals(mayJoinExisting(bot, null, { ...theirCalendar, claim_owner: PERSON }, noCalendar), true);
});

Deno.test("комната без состава — не сверяем (D016)", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirRoom, attendees: [] }, noCalendar), true);
  assertEquals(
    mayJoinExisting(bot, "person@team.io", { ...theirRoom, attendees: [{ name: "Без почты" }] }, noCalendar),
    true,
  );
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirRoom, attendees: null }, noCalendar), true);
});

Deno.test("люди присоединяются как раньше — сверка их не касается", () => {
  assertEquals(mayJoinExisting(recorder, null, theirCalendar, null), true);
  assertEquals(mayJoinExisting(recorder, null, theirRoom, null), true);
});

Deno.test("БЛОКИРУЮЩИЙ: агент без контекста сверки не присоединяется никуда, кроме своего", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirRoom, attendees: [] }, null), false);
  assertEquals(mayJoinExisting(bot, null, { ...theirRoom, claim_owner: PERSON }, null), true);
});
