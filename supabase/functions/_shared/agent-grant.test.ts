// Пропуск бота на одну встречу (T165). Ядро прав доступа: пропуск решает, какую встречу бот
// может заявить, продлить, выгрузить и о какой сказать человеку. Ошибка молчалива — бот
// действует на встрече, куда его не звали, — поэтому каждая граница отдельным тестом.
import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AgentGrant,
  assertGrantClaim,
  assertGrantMeeting,
  bindGrantMeeting,
  GRANT_TTL_MS,
  grantMeetingFilter,
  grantRow,
  GrantScopeError,
  newGrantToken,
} from "./agent-grant.ts";

const M = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const KEY = "standup@google.com:2026-09-28";

const calendarGrant: AgentGrant = {
  id: "g1",
  agentId: "scriba",
  basis: "calendar",
  inviteId: null,
  calendarKey: KEY,
  joinUrl: "https://meet.google.com/abc-defg-hij",
  title: "Standup",
  meetingId: null,
};
const inviteGrant: AgentGrant = { ...calendarGrant, basis: "invite", inviteId: "inv-1", calendarKey: null, title: null };
const bot = (grant: AgentGrant | undefined) => ({ kind: "bot", grant });
const human = { kind: "recorder" };

Deno.test("пропуск — случайный и с префиксом, два подряд не совпадают", () => {
  const a = newGrantToken();
  assertEquals(a.startsWith("sgr_") && a.length > 40, true, a);
  assertEquals(a === newGrantToken(), false);
});

Deno.test("строка пропуска: основание, срок; у задания — ключ и название события", () => {
  const now = Date.parse("2026-09-28T10:00:00Z");
  const common = { agentId: "scriba", groupId: "ws", telegramId: 111, joinUrl: "https://meet.google.com/x" };
  assertEquals(grantRow({ ...common, inviteId: "inv-1" }, "h", now), {
    token_hash: "h",
    agent_id: "scriba",
    group_id: "ws",
    telegram_id: 111,
    join_url: "https://meet.google.com/x",
    expires_at: new Date(now + GRANT_TTL_MS).toISOString(),
    invite_id: "inv-1",
  });
  const cal = grantRow({ ...common, calendarJobId: "j1", calendarKey: KEY, title: "Standup" }, "h", now);
  assertEquals([cal.calendar_job_id, cal.calendar_key, cal.title, cal.invite_id], ["j1", KEY, "Standup", undefined]);
});

Deno.test("БЛОКИРУЮЩИЙ: дверь по встрече — только встреча своего пропуска", () => {
  const bound = bot({ ...calendarGrant, meetingId: M });
  assertGrantMeeting(bound, M);
  assertGrantMeeting(bound, M.toUpperCase());
  assertThrows(() => assertGrantMeeting(bound, OTHER), GrantScopeError);
});

Deno.test("БЛОКИРУЮЩИЙ: пропуск без заявки не открывает ни одной встречи", () => {
  assertThrows(() => assertGrantMeeting(bot(calendarGrant), M), GrantScopeError);
  assertEquals(grantMeetingFilter(bot(calendarGrant)), []);
  assertEquals(grantMeetingFilter(bot({ ...calendarGrant, meetingId: M })), [M]);
});

Deno.test("БЛОКИРУЮЩИЙ: бот без пропуска не проходит ни одну дверь по встрече", () => {
  assertThrows(() => assertGrantMeeting(bot(undefined), M), GrantScopeError);
  assertThrows(() => grantMeetingFilter(bot(undefined)), GrantScopeError);
  assertThrows(() => assertGrantClaim(bot(undefined), "calendar", { identity_key: KEY }), GrantScopeError);
});

Deno.test("людей пропуск не касается: их токен и есть их личность", () => {
  assertGrantMeeting(human, OTHER);
  assertEquals(grantMeetingFilter(human), null);
  assertGrantClaim(human, "room", { identity_key: "meet:abc-defg-hij" });
});

Deno.test("БЛОКИРУЮЩИЙ: заявка по заданию — только календарная встреча своего события", () => {
  assertGrantClaim(bot(calendarGrant), "calendar", { identity_key: KEY });
  assertThrows(
    () => assertGrantClaim(bot(calendarGrant), "calendar", { identity_key: "other@google.com:2026-09-28" }),
    GrantScopeError,
  );
  assertThrows(
    () => assertGrantClaim(bot(calendarGrant), "manual", { identity_key: "x", invite_id: "inv-1" }),
    GrantScopeError,
  );
});

Deno.test("БЛОКИРУЮЩИЙ: заявка по приглашению — только ручная встреча этого приглашения", () => {
  assertGrantClaim(bot(inviteGrant), "manual", { identity_key: "x", invite_id: "inv-1" });
  for (const invite_id of ["inv-2", undefined, 7]) {
    assertThrows(() => assertGrantClaim(bot(inviteGrant), "manual", { identity_key: "x", invite_id }), GrantScopeError);
  }
  assertThrows(() => assertGrantClaim(bot(inviteGrant), "calendar", { identity_key: KEY }), GrantScopeError);
});

Deno.test("БЛОКИРУЮЩИЙ: комнатную встречу бот не заводит ни по какому пропуску (D017)", () => {
  for (const g of [calendarGrant, inviteGrant]) {
    assertThrows(() => assertGrantClaim(bot(g), "room", { identity_key: "meet:abc-defg-hij" }), GrantScopeError);
  }
});

// ── Привязка к встрече ──────────────────────────────────────────────────────

function grantsTable(opts: { updated: number; current: string | null }) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["update", "eq", "is", "select"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ op: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: Array.from({ length: opts.updated }, () => ({ id: "g1" })), error: null });
  builder.maybeSingle = () => Promise.resolve({ data: { meeting_id: opts.current } });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("привязка: первая заявка ставит встречу условным UPDATE (meeting_id is null)", async () => {
  const { client, calls } = grantsTable({ updated: 1, current: null });
  await bindGrantMeeting(client, bot(calendarGrant), M);
  assertEquals(calls.find((c) => c.op === "update")?.args[0], { meeting_id: M });
  assertEquals(calls.some((c) => c.op === "is" && c.args[0] === "meeting_id" && c.args[1] === null), true);
});

Deno.test("БЛОКИРУЮЩИЙ: пропуск, привязанный к одной встрече, другую не открывает", async () => {
  const { client, calls } = grantsTable({ updated: 1, current: M });
  await assertRejects(() => bindGrantMeeting(client, bot({ ...calendarGrant, meetingId: M }), OTHER), GrantScopeError);
  assertEquals(calls.length, 0, "в базу даже не ходили");
  await bindGrantMeeting(client, bot({ ...calendarGrant, meetingId: M }), M);
});

Deno.test("БЛОКИРУЮЩИЙ: гонка двух заявок — проигравшая на другую встречу получает отказ", async () => {
  const lost = grantsTable({ updated: 0, current: OTHER });
  await assertRejects(() => bindGrantMeeting(lost.client, bot(calendarGrant), M), GrantScopeError);
  const same = grantsTable({ updated: 0, current: M });
  await bindGrantMeeting(same.client, bot(calendarGrant), M);
});
