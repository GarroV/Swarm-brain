/**
 * Клиент `POST /meeting-calendar` (T100). Забранное задание не вернётся сервером повторно,
 * поэтому кривой разбор здесь стоит так же дорого, как у приглашений (D017): пропущенное —
 * в `malformed` с причиной, а не потеряно молча.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SwarmHttpError, SwarmProtocolError, SwarmTransportError } from "../swarm-client/errors.ts";
import { CalendarClient, parseCalendarSweep } from "./calendar-client.ts";

const server = readFileSync(
  new URL("../../../supabase/functions/meeting-calendar/index.ts", import.meta.url),
  "utf8",
);

const TOKEN = "calendar-token";

const validJob = {
  id: "job-1",
  calendar_key: "evt-1:2026-09-28",
  invited_by: 744_230_399,
  join_url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
  title: "Синк",
  starts_at: "2026-09-28T10:00:00.000Z",
  ends_at: "2026-09-28T10:30:00.000Z",
};

const validSkip = {
  invited_by: 744_230_399,
  calendar_key: "evt-2:2026-09-28",
  title: "Другое",
  reason: "no_conference_link",
};

describe("сверка с сервером", () => {
  it("имена полей задания — ровно JOB_COLUMNS сервера", () => {
    expect(server).toContain(
      'const JOB_COLUMNS = "id, calendar_key, invited_by, join_url, platform, title, starts_at, ends_at"',
    );
    for (const field of Object.keys(validJob)) {
      expect(server).toContain(field);
    }
  });

  it("ответ — { ok: true, jobs, skipped }", () => {
    // jobs — те же задания с пропуском бота на встречу (T165), под именем grant_token.
    expect(server).toContain("json({ ok: true, ...result, jobs })");
    expect(server).toContain("grant_token: tokens[n]");
  });
});

describe("parseCalendarSweep", () => {
  it("целое задание и пропуск проходят как есть", () => {
    const parsed = parseCalendarSweep({ ok: true, jobs: [validJob], skipped: [validSkip] });

    expect(parsed).toEqual({ jobs: [validJob], skipped: [validSkip], malformed: [] });
  });

  it.each([
    ["не объект", null],
    ["ok не true", { ok: false, jobs: [], skipped: [] }],
    ["нет списка jobs", { ok: true, skipped: [] }],
    ["jobs не массив", { ok: true, jobs: {}, skipped: [] }],
    ["нет списка skipped", { ok: true, jobs: [] }],
    ["skipped не массив", { ok: true, jobs: [], skipped: {} }],
  ])("%s — SwarmProtocolError", (_name, body) => {
    expect(() => parseCalendarSweep(body)).toThrow(SwarmProtocolError);
  });

  it.each([
    ["без id", { ...validJob, id: "" }, /id/u],
    ["без calendar_key", { ...validJob, calendar_key: "" }, /calendar_key/u],
    ["invited_by не число", { ...validJob, invited_by: "744230399" }, /invited_by/u],
    ["invited_by ноль", { ...validJob, invited_by: 0 }, /invited_by/u],
    [
      "join_url не https",
      { ...validJob, join_url: ["http", "://meet.google.com/abc"].join("") },
      /join_url/u,
    ],
    ["без platform", { ...validJob, platform: "" }, /platform/u],
    ["starts_at не время", { ...validJob, starts_at: "не время" }, /starts_at/u],
    ["ends_at не время", { ...validJob, ends_at: undefined }, /ends_at/u],
    ["title не строка и не null", { ...validJob, title: 7 }, /title/u],
    ["пропуск пустой", { ...validJob, grant_token: "" }, /grant_token/u],
    ["не объект", "job-9", /не объект/u],
  ])("%s — кривое задание в malformed, соседи целы", (_name, broken, reason) => {
    const parsed = parseCalendarSweep({ ok: true, jobs: [broken, validJob], skipped: [] });

    expect(parsed.jobs).toEqual([validJob]);
    expect(parsed.malformed).toHaveLength(1);
    expect(parsed.malformed[0]).toMatch(reason);
    expect(parsed.malformed[0]).toMatch(/jobs\[0\]/u);
  });

  it("в причине есть id кривого задания, если он читается", () => {
    const parsed = parseCalendarSweep({
      ok: true,
      jobs: [{ ...validJob, invited_by: null }],
      skipped: [],
    });

    expect(parsed.malformed[0]).toContain("job-1");
  });

  it("title допускается null", () => {
    const parsed = parseCalendarSweep({
      ok: true,
      jobs: [{ ...validJob, title: null }],
      skipped: [],
    });

    expect(parsed.jobs).toEqual([{ ...validJob, title: null }]);
  });

  it("кривой пропуск отброшен молча — это только сведения для журнала", () => {
    const parsed = parseCalendarSweep({
      ok: true,
      jobs: [],
      skipped: [validSkip, { invited_by: 744_230_399 }, { reason: "x" }, "не объект"],
    });

    expect(parsed.skipped).toEqual([validSkip]);
    expect(parsed.malformed).toEqual([]);
  });

  it("пропуск уровня человека — calendar_key может быть null", () => {
    const skip = {
      invited_by: 744_230_399,
      calendar_key: null,
      title: null,
      reason: "calendar_token_dead",
    };

    const parsed = parseCalendarSweep({ ok: true, jobs: [], skipped: [skip] });

    expect(parsed.skipped).toEqual([skip]);
  });
});

function client(fetchImpl: typeof globalThis.fetch): CalendarClient {
  return new CalendarClient({
    baseUrl: "https://swarm.example/functions/v1",
    token: TOKEN,
    fetch: fetchImpl,
  });
}

describe("CalendarClient.sweep", () => {
  it("ходит по адресу <baseUrl>/meeting-calendar, срезав хвостовой слэш", async () => {
    const seen: string[] = [];
    const bot = new CalendarClient({
      baseUrl: "https://swarm.example/functions/v1//",
      token: TOKEN,
      fetch: (input): Promise<Response> => {
        seen.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(Response.json({ ok: true, jobs: [], skipped: [] }));
      },
    });

    await bot.sweep();

    expect(seen).toEqual(["https://swarm.example/functions/v1/meeting-calendar"]);
  });

  it("шлёт токен агента и НЕ шлёт X-On-Behalf-Of", async () => {
    const seenHeaders: Headers[] = [];
    const bot = client((_input, init): Promise<Response> => {
      seenHeaders.push(new Headers(init?.headers));
      return Promise.resolve(Response.json({ ok: true, jobs: [], skipped: [] }));
    });

    await bot.sweep();

    expect(seenHeaders[0]?.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seenHeaders[0]?.has("X-On-Behalf-Of")).toBe(false);
  });

  it("разобранные задания и пропуски доходят из тела ответа", async () => {
    const bot = client(() =>
      Promise.resolve(Response.json({ ok: true, jobs: [validJob], skipped: [validSkip] })),
    );

    const sweep = await bot.sweep();

    expect(sweep).toEqual({ jobs: [validJob], skipped: [validSkip], malformed: [] });
  });

  it("HTTP-ошибка сервера — SwarmHttpError со статусом", async () => {
    const bot = client(() => Promise.resolve(new Response("boom", { status: 500 })));

    await expect(bot.sweep()).rejects.toBeInstanceOf(SwarmHttpError);
    await expect(bot.sweep()).rejects.toMatchObject({ status: 500 });
  });

  it("сеть недоступна — SwarmTransportError", async () => {
    const bot = client(() => Promise.reject(new Error("fetch failed")));

    await expect(bot.sweep()).rejects.toBeInstanceOf(SwarmTransportError);
  });

  it("ответ не JSON — SwarmProtocolError", async () => {
    const bot = client(() => Promise.resolve(new Response("<html>502</html>")));

    await expect(bot.sweep()).rejects.toBeInstanceOf(SwarmProtocolError);
  });

  it("ответ ok:true, но без jobs/skipped — SwarmProtocolError", async () => {
    const bot = client(() => Promise.resolve(Response.json({ ok: true })));

    await expect(bot.sweep()).rejects.toBeInstanceOf(SwarmProtocolError);
  });
});
