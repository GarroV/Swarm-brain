// Сужение полномочий служебного агента до состава встречи (решение D016, issue #371).
//
// Ядро прав доступа: ошибка здесь молчалива — приватная запись встаёт на человека, которого на
// звонке не было, и никто этого не видит. Поэтому каждая граница — отдельным тестом, и каждый
// проверен порчей.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import type { GEvent } from "../meeting-current/select.ts";
import {
  AgentScopeError,
  assertCalendarMembership,
  calendarKeyOf,
  type CalendarSource,
  mayJoinExisting,
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
};
const STANDUP_KEY = "standup@google.com:2026-09-25";

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

async function refused(p: Promise<unknown>, status: number): Promise<string> {
  const e = await assertRejects(() => p, AgentScopeError);
  assertEquals(e.status, status, `ожидался отказ ${status}, пришёл ${e.status}: ${e.message}`);
  return e.message;
}

// ── Ключ календарной встречи ─────────────────────────────────────────────────

Deno.test("ключ события собирается так же, как его отдаёт meeting-current", () => {
  assertEquals(calendarKeyOf(standup), STANDUP_KEY);
  assertEquals(calendarKeyOf({ ...standup, iCalUID: undefined }), "ev1:2026-09-25");
  assertEquals(calendarKeyOf({ ...standup, start: { date: "2026-09-25" } }), null);
});

// ── Календарная встреча: человек обязан её иметь в своём календаре ──────────

Deno.test("БЛОКИРУЮЩИЙ: агент не заводит календарную встречу на человека, у которого её нет", async () => {
  const src = source({ events: [{ ...standup, iCalUID: "someone-elses@google.com" }] });
  const msg = await refused(
    assertCalendarMembership(src, bot, { identity_kind: "calendar", identity_key: STANDUP_KEY }),
    403,
  );
  assertEquals(msg.includes("not a participant"), true, msg);
});

Deno.test("БЛОКИРУЮЩИЙ: та же встреча другого дня не засчитывается (повторяющаяся серия)", async () => {
  const src = source();
  await refused(
    assertCalendarMembership(src, bot, {
      identity_kind: "calendar",
      identity_key: "standup@google.com:2026-09-26",
    }),
    403,
  );
});

Deno.test("агент проходит, когда встреча есть в календаре названного человека", async () => {
  const src = source();
  await assertCalendarMembership(src, bot, { identity_kind: "calendar", identity_key: STANDUP_KEY });
  assertEquals(src.calls.refresh, [PERSON], "календарь смотрится ТОГО человека, за кого просят");
  const [[min, max]] = src.calls.windows;
  assertEquals(min <= "2026-09-25T00:00:00.000Z" && max >= "2026-09-26T00:00:00.000Z", true);
});

Deno.test("БЛОКИРУЮЩИЙ: календарь человека не подключён → календарную встречу не заводим", async () => {
  const msg = await refused(
    assertCalendarMembership(source({ refresh: null }), bot, {
      identity_kind: "calendar",
      identity_key: STANDUP_KEY,
    }),
    403,
  );
  assertEquals(msg.includes("manual"), true, `отказ должен звать на ручной путь: ${msg}`);
});

Deno.test("БЛОКИРУЮЩИЙ: календарь не отвечает → отказ, а не пропуск без сверки", async () => {
  for (const opts of [{ token: "dead" as const }, { token: "down" as const }, { events: null }]) {
    await refused(
      assertCalendarMembership(source(opts), bot, {
        identity_kind: "calendar",
        identity_key: STANDUP_KEY,
      }),
      503,
    );
  }
});

Deno.test("БЛОКИРУЮЩИЙ: ключ без даты не сверяется и не проходит", async () => {
  await refused(
    assertCalendarMembership(source(), bot, {
      identity_kind: "calendar",
      identity_key: "standup@google.com",
    }),
    403,
  );
});

Deno.test("ручная и комнатная встречи агента — без сверки состава (D015, D016)", async () => {
  const src = source({ refresh: null });
  await assertCalendarMembership(src, bot, { identity_kind: "manual", identity_key: "tg:1" });
  await assertCalendarMembership(src, bot, { identity_kind: "room", identity_key: "kontur:abc" });
  assertEquals(src.calls.refresh, [], "в календарь не ходим вовсе");
});

Deno.test("люди (рекордер, MCP) не сверяются — их поведение не меняется", async () => {
  const src = source({ refresh: null });
  for (const kind of ["recorder", "recorder_prev", "mcp"] as const) {
    await assertCalendarMembership(src, { ...recorder, kind }, {
      identity_kind: "calendar",
      identity_key: STANDUP_KEY,
    });
  }
  assertEquals(src.calls.refresh, []);
});

// ── Присоединение к уже открытой встрече ────────────────────────────────────

const theirs = {
  identity_key: "their-sync@google.com:2026-09-25",
  claim_owner: OTHER,
  attendees: [{ name: "Other", email: "other@team.io" }, { email: "boss@team.io" }],
};

Deno.test("БЛОКИРУЮЩИЙ: агент не присоединяется к чужой встрече, где человека нет в составе", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", theirs, null), false);
  assertEquals(mayJoinExisting(bot, null, theirs, null), false, "без почты сверить нечем — отказ");
});

Deno.test("БЛОКИРУЮЩИЙ: подтверждённый календарём ключ не открывает ДРУГУЮ встречу", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", theirs, STANDUP_KEY), false);
});

Deno.test("агент присоединяется, если человек в составе (регистр почты не важен)", () => {
  assertEquals(
    mayJoinExisting(bot, " Person@Team.io ", {
      ...theirs,
      attendees: [...theirs.attendees, { email: "person@team.IO" }],
    }, null),
    true,
  );
});

Deno.test("агент присоединяется к встрече, которую уже держит тот же человек", () => {
  assertEquals(mayJoinExisting(bot, null, { ...theirs, claim_owner: PERSON }, null), true);
});

Deno.test("агент присоединяется к встрече своего подтверждённого ключа", () => {
  assertEquals(
    mayJoinExisting(bot, "person@team.io", { ...theirs, identity_key: STANDUP_KEY }, STANDUP_KEY),
    true,
  );
});

Deno.test("состав неизвестен (ручная/комнатная встреча) — не сверяем (D016)", () => {
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirs, attendees: [] }, null), true);
  assertEquals(
    mayJoinExisting(bot, "person@team.io", { ...theirs, attendees: [{ name: "Без почты" }] }, null),
    true,
  );
  assertEquals(mayJoinExisting(bot, "person@team.io", { ...theirs, attendees: null }, null), true);
});

Deno.test("люди присоединяются как раньше — сверка их не касается", () => {
  assertEquals(mayJoinExisting(recorder, null, theirs, null), true);
});
