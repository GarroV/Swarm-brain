import { assertEquals } from "@std/assert";
import { type CalendarDeps, todayCalendarEvents } from "./calendar-today.ts";

const db = (apiKey: string | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: apiKey ? { api_key: apiKey } : null }) }),
        }),
      }),
    }),
  }) as never;

function deps(over: Partial<CalendarDeps> & { statuses?: Array<number | "ok"> }) {
  const log: string[] = [];
  const statuses = over.statuses ?? ["ok"];
  let tokenN = 0;
  let listN = 0;
  const d: CalendarDeps = {
    accessToken: over.accessToken ?? (() => {
      log.push("token");
      return Promise.resolve({ ok: true, token: `t${++tokenN}` });
    }),
    dropCachedToken: () => {
      log.push("drop");
      return Promise.resolve();
    },
    listEventsResult: (token: string) => {
      log.push(`list:${token}`);
      const s = statuses[Math.min(listN++, statuses.length - 1)];
      return Promise.resolve(s === "ok" ? { ok: true as const, events: [] } : { ok: false as const, status: s });
    },
  };
  return { d, log };
}

Deno.test("calendar/today: 401 от Google — токен сбрасывается и запрос повторяется один раз", async () => {
  const { d, log } = deps({ statuses: [401, "ok"] });
  assertEquals(await todayCalendarEvents(db("r"), 1, 0, new Date(), d), { ok: true, events: [] });
  assertEquals(log, ["token", "list:t1", "drop", "token", "list:t2"]);
});

Deno.test("calendar/today: повторный 401 — calendar_error, без третьей попытки", async () => {
  const { d, log } = deps({ statuses: [401, 401, "ok"] });
  assertEquals(await todayCalendarEvents(db("r"), 1, 0, new Date(), d), { ok: false, reason: "calendar_error" });
  assertEquals(log.filter((l) => l.startsWith("list")).length, 2);
});

Deno.test("calendar/today: мёртвый грант — token_expired, к Google за событиями не идём", async () => {
  const { d, log } = deps({ accessToken: () => Promise.resolve({ ok: false, deadGrant: true }) });
  assertEquals(await todayCalendarEvents(db("r"), 1, 0, new Date(), d), { ok: false, reason: "token_expired" });
  assertEquals(log, []);
});

Deno.test("calendar/today: 500 не повторяется и не сбрасывает кэш; нет интеграции — not_connected", async () => {
  const { d, log } = deps({ statuses: [500] });
  assertEquals(await todayCalendarEvents(db("r"), 1, 0, new Date(), d), { ok: false, reason: "calendar_error" });
  assertEquals(log, ["token", "list:t1"]);
  assertEquals(await todayCalendarEvents(db(null), 1, 0, new Date(), d), { ok: false, reason: "not_connected" });
});
