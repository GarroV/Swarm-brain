/**
 * Провода автозапуска по календарю: задание уходит в `startForMeeting` от имени владельца
 * календаря с ключом события, а задание, по которому контейнер не поднялся, кончается
 * календарной заявкой за того же человека и нотисой `join_failed` с номером встречи.
 * Сервер — заглушка `fetch`: проверяется, что и куда уходит по проводу.
 */
import { describe, expect, it } from "vitest";

import { calendarTriggerFor } from "./calendar-service.ts";
import type { CalendarReference } from "./claim-request.ts";
import type { Notice, NoticeResult } from "./notices.ts";

const TOKEN = "svc-token";
const PERSON = 744_230_399;
const JOB = {
  id: "job-1",
  calendar_key: "uid1@google.com:2026-09-28",
  invited_by: PERSON,
  join_url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
  title: "Weekly",
  starts_at: "2026-09-28T07:01:00+00:00",
  ends_at: "2026-09-28T07:30:00+00:00",
  grant_token: "sgr_job-pass",
};

interface Seen {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function wire(start: () => Promise<string>) {
  const seen: Seen[] = [];
  const starts: [string, string, number, CalendarReference][] = [];
  const notices: [number, Notice, string][] = [];
  const lines: string[] = [];
  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = init?.body;
    seen.push({
      url,
      headers: new Headers(init?.headers),
      body: typeof raw === "string" ? JSON.parse(raw) : null,
    });
    if (url.endsWith("/meeting-calendar")) {
      return Promise.resolve(Response.json({ ok: true, jobs: [JOB], skipped: [] }));
    }
    return Promise.resolve(
      Response.json({ meeting_id: "m-1", decision: "transcribe", lease_ttl_sec: 1800 }),
    );
  };
  const trigger = calendarTriggerFor({
    swarmUrl: "https://swarm.test/functions/v1",
    token: TOKEN,
    version: 3,
    startForMeeting: async (joinUrl, platform, onBehalfOf, calendar) => {
      starts.push([joinUrl, platform, onBehalfOf, calendar]);
      return start();
    },
    notifierFor: (onBehalfOf, token) => ({
      notify: (notice): Promise<NoticeResult> => {
        notices.push([onBehalfOf, notice, token]);
        return Promise.resolve({ delivered: true, shouldLeave: false });
      },
    }),
    log: (line) => {
      lines.push(line);
    },
    intervalMs: 10_000,
    fetch: fetchStub,
  });
  return { trigger, seen, starts, notices, lines };
}

describe("calendarTriggerFor", () => {
  it("задание → бот за владельца календаря с ключом и началом события", async () => {
    const { trigger, seen, starts, notices } = wire(() => Promise.resolve("c1"));
    await trigger.pollOnce();
    expect(starts).toEqual([
      [
        JOB.join_url,
        "meet",
        PERSON,
        { calendarKey: JOB.calendar_key, startsAt: JOB.starts_at, grantToken: JOB.grant_token },
      ],
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.headers.has("X-On-Behalf-Of")).toBe(false);
    expect(notices).toEqual([]);
  });

  it("контейнер не поднялся → календарная заявка за того же человека и join_failed", async () => {
    const { trigger, seen, notices } = wire(() => Promise.reject(new Error("docker down")));
    await trigger.pollOnce();
    const claim = seen.find((s) => s.url.endsWith("/meeting-claim"));
    expect(claim?.headers.get("X-On-Behalf-Of")).toBe(String(PERSON));
    // Заявка и отказ — по пропуску задания (T165), не общим токеном агента.
    expect(claim?.headers.get("Authorization")).toBe(`Bearer ${JOB.grant_token}`);
    expect(claim?.body).toMatchObject({
      identity_kind: "calendar",
      identity_key: JOB.calendar_key,
      started_at: JOB.starts_at,
    });
    expect(claim?.body).not.toHaveProperty("invite_id");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.[0]).toBe(PERSON);
    expect(notices[0]?.[2]).toBe(JOB.grant_token);
    expect(notices[0]?.[1]).toMatchObject({ kind: "join_failed", meetingId: "m-1" });
    expect(JSON.stringify(notices[0]?.[1])).toContain("docker down");
  });

  it("start/close: опрос идёт по кругу и останавливается, доведя идущий до конца", async () => {
    const { trigger, seen } = wire(() => Promise.resolve("c1"));
    trigger.start();
    expect(() => {
      trigger.start();
    }).toThrow(/уже/u);
    await trigger.close();
    expect(seen.filter((s) => s.url.endsWith("/meeting-calendar"))).toHaveLength(1);
  });
});
