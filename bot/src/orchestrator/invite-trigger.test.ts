/**
 * Ручной запуск по приглашению (решение D017): человек вставил ссылку в вебе — оркестратор
 * забрал приглашение и поднял бота от его имени. Ошибка здесь молчаливая и дорогая: бот не
 * пришёл, человек ждал, записи нет. Поэтому на каждое «не пошли» — громкий отказ человеку, а
 * одно приглашение никогда не поднимает двух ботов.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeetingInvite } from "../swarm-client/contract.ts";
import type { TakenInvites } from "../swarm-client/invites.ts";
import { InviteTrigger, MAX_REFUSAL_DETAIL_CHARS, refusalDetail } from "./invite-trigger.ts";

const PERSON = 744_230_399;

function invite(overrides: Partial<MeetingInvite> = {}): MeetingInvite {
  return {
    id: "inv-1",
    invited_by: PERSON,
    join_url: "https://meet.google.com/abc-defg-hij",
    platform: "meet",
    created_at: "2026-09-26T10:00:00.000Z",
    expires_at: "2099-09-26T10:15:00.000Z",
    ...overrides,
  };
}

interface Harness {
  readonly trigger: InviteTrigger;
  readonly started: MeetingInvite[];
  readonly refused: { invite: MeetingInvite; detail: string }[];
  readonly lines: string[];
  readonly batches: TakenInvites[];
  failStart: Error | null;
  failRefuse: Error | null;
  failTake: Error | null;
}

function harness(intervalMs = 1000): Harness {
  const state: Omit<Harness, "trigger"> = {
    started: [],
    refused: [],
    lines: [],
    batches: [],
    failStart: null,
    failRefuse: null,
    failTake: null,
  };
  const trigger = new InviteTrigger({
    take: () => {
      if (state.failTake !== null) return Promise.reject(state.failTake);
      return Promise.resolve(state.batches.shift() ?? { invites: [], malformed: [] });
    },
    start: (taken) => {
      if (state.failStart !== null) return Promise.reject(state.failStart);
      state.started.push(taken);
      return Promise.resolve(`c-${taken.id}`);
    },
    refuse: (taken, detail) => {
      if (state.failRefuse !== null) return Promise.reject(state.failRefuse);
      state.refused.push({ invite: taken, detail });
      return Promise.resolve();
    },
    log: (line) => {
      state.lines.push(line);
    },
    intervalMs,
  });
  return Object.assign(state, { trigger });
}

function batch(...invites: MeetingInvite[]): TakenInvites {
  return { invites, malformed: [] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("InviteTrigger.pollOnce", () => {
  it("приглашение на Meet — бот поднят от имени позвавшего", async () => {
    const h = harness();
    h.batches.push(batch(invite()));

    await h.trigger.pollOnce();

    expect(h.started.map((taken) => [taken.id, taken.invited_by])).toEqual([["inv-1", PERSON]]);
    expect(h.refused).toEqual([]);
    expect(h.lines.join("\n")).toMatch(/inv-1.*c-inv-1/u);
  });

  it.each([
    ["kontur", /Kontur\.Talk/u, /Контур\.Толк/u],
    ["zoom", /Zoom/u, /Zoom/u],
    ["teams", /«teams»/u, /«teams»/u],
  ])(
    "площадка %s — контейнер не поднят, человеку громкий отказ на EN и RU",
    async (platform, en, ru) => {
      const h = harness();
      h.batches.push(batch(invite({ platform, join_url: "https://ktalk.ru/room/abc" })));

      await h.trigger.pollOnce();

      expect(h.started).toEqual([]);
      expect(h.refused).toHaveLength(1);
      const detail = h.refused[0]?.detail ?? "";
      expect(detail).toMatch(en);
      expect(detail).toMatch(ru);
      expect(detail).toMatch(/Google Meet/u);
      expect(h.lines.join("\n")).toMatch(/ОТКАЗ.*inv-1/u);
    },
  );

  it("контейнер не поднялся — человеку отказ с причиной", async () => {
    const h = harness();
    h.failStart = new Error("no such image");
    h.batches.push(batch(invite()));

    await h.trigger.pollOnce();

    expect(h.refused).toHaveLength(1);
    expect(h.refused[0]?.detail).toContain("no such image");
  });

  it("отказ не доставлен — громко в журнал, следующее приглашение всё равно обработано", async () => {
    const h = harness();
    h.failRefuse = new Error("meeting-notice 500");
    h.batches.push(batch(invite({ id: "k", platform: "kontur" }), invite({ id: "m" })));

    await h.trigger.pollOnce();

    const lost = h.lines.find((line) => line.startsWith("ОТКАЗ НЕ ДОСТАВЛЕН по приглашению k:"));
    expect(lost).toContain("meeting-notice 500");
    expect(h.started.map((taken) => taken.id)).toEqual(["m"]);
  });

  it("одно приглашение не поднимает двух ботов, даже если пришло повторно", async () => {
    const h = harness();
    h.batches.push(batch(invite(), invite()), batch(invite()));

    await h.trigger.pollOnce();
    await h.trigger.pollOnce();

    expect(h.started).toHaveLength(1);
    expect(h.lines.join("\n")).toMatch(/inv-1.*повторно/u);
  });

  it("память о запущенных чистится по сроку приглашения", async () => {
    const h = harness();
    h.batches.push(batch(invite({ expires_at: "2000-01-01T00:00:00.000Z" })), batch(invite()));

    await h.trigger.pollOnce();
    await h.trigger.pollOnce();

    expect(h.trigger.rememberedCount).toBe(1);
  });

  it("опрос сорвался — журнал, а не исключение наружу", async () => {
    const h = harness();
    h.failTake = new Error("meeting-invite 503");

    await expect(h.trigger.pollOnce()).resolves.toBeUndefined();

    expect(h.lines.join("\n")).toMatch(/опрос приглашений не удался.*meeting-invite 503/u);
  });

  it("кривое приглашение в пачке — громко: оно уже забрано и потеряно", async () => {
    const h = harness();
    h.batches.push({ invites: [invite()], malformed: ["invites[1] (inv-9): нет platform"] });

    await h.trigger.pollOnce();

    expect(h.lines.join("\n")).toMatch(/ПРИГЛАШЕНИЕ ПОТЕРЯНО.*inv-9/u);
    expect(h.started).toHaveLength(1);
  });
});

describe("refusalDetail", () => {
  it("длинная причина обрезается под предел сервера", () => {
    const detail = refusalDetail({ kind: "start_failed", reason: "x".repeat(1000) });

    expect(detail.length).toBeLessThanOrEqual(MAX_REFUSAL_DETAIL_CHARS);
    expect(detail).toMatch(/^scriba could not start/u);
    expect(detail).toMatch(/scriba не смог запуститься/u);
  });

  it("текст площадки влезает в предел", () => {
    const detail = refusalDetail({ kind: "platform", platform: "kontur" });

    expect(detail.length).toBeLessThanOrEqual(MAX_REFUSAL_DETAIL_CHARS);
  });
});

describe("InviteTrigger.start / close", () => {
  it("опрашивает по интервалу и перестаёт после close", async () => {
    vi.useFakeTimers();
    const h = harness(1000);
    const take = vi.spyOn(h.trigger, "pollOnce");

    h.trigger.start();
    await vi.advanceTimersByTimeAsync(3500);
    await h.trigger.close();
    const calls = take.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(calls).toBe(4);
    expect(take.mock.calls).toHaveLength(calls);
  });

  it("медленный опрос не наслаивается на следующий, close дожидается идущего", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let inFlight = 0;
    let maxInFlight = 0;
    const trigger = new InviteTrigger({
      take: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- lib проекта ES2023, withResolvers там нет
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        inFlight -= 1;
        return { invites: [], malformed: [] };
      },
      start: () => Promise.resolve("c"),
      refuse: () => Promise.resolve(),
      log: (): void => {
        // тихо
      },
      intervalMs: 100,
    });

    trigger.start();
    await vi.advanceTimersByTimeAsync(1000);
    const closed = trigger.close();
    release?.();
    await closed;

    expect(maxInFlight).toBe(1);
    expect(inFlight).toBe(0);
  });

  it("второй start — ошибка, а не второй цикл опроса", () => {
    const h = harness();
    h.trigger.start();

    expect(() => {
      h.trigger.start();
    }).toThrow(/уже/u);
    void h.trigger.close();
  });
});
