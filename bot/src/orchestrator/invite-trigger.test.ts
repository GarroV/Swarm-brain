/**
 * Ручной запуск по приглашению (решение D017): человек вставил ссылку в вебе — оркестратор
 * забрал приглашение и поднял бота от его имени. Ошибка здесь молчаливая и дорогая: бот не
 * пришёл, человек ждал, записи нет. Поэтому на каждое «не пошли» — громкий отказ человеку, а
 * одно приглашение никогда не поднимает двух ботов.
 */
import { describe, expect, it } from "vitest";

import type { MeetingInvite } from "../swarm-client/contract.ts";
import type { TakenInvites } from "../swarm-client/invites.ts";
import {
  type InviteContainerExit,
  InviteTrigger,
  MAX_REFUSAL_DETAIL_CHARS,
  refusalDetail,
} from "./invite-trigger.ts";

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
  /**
   * Чем кончится контейнер; undefined — выход ещё неизвестен.
   */
  exit: InviteContainerExit | undefined;
  failExit: Error | null;
}

function harness(shouldWatchExit = true): Harness {
  const state: Omit<Harness, "trigger"> = {
    started: [],
    refused: [],
    lines: [],
    batches: [],
    failStart: null,
    failRefuse: null,
    failTake: null,
    exit: undefined,
    failExit: null,
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
    ...(shouldWatchExit && {
      whenExited: () =>
        state.failExit === null ? Promise.resolve(state.exit) : Promise.reject(state.failExit),
    }),
    log: (line) => {
      state.lines.push(line);
    },
  });
  return Object.assign(state, { trigger });
}

function batch(...invites: MeetingInvite[]): TakenInvites {
  return { invites, malformed: [] };
}

describe("InviteTrigger.dispatch", () => {
  it("приглашение на Meet — бот поднят от имени позвавшего", async () => {
    const h = harness();
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();

    expect(h.started.map((taken) => [taken.id, taken.invited_by])).toEqual([["inv-1", PERSON]]);
    expect(h.refused).toEqual([]);
    expect(h.lines.join("\n")).toMatch(/inv-1.*c-inv-1/u);
  });

  it("приглашение в Контур.Толк — бот поднят, отказа нет (T111)", async () => {
    const h = harness();
    h.batches.push(
      batch(invite({ platform: "kontur", join_url: "https://dodobrands.ktalk.ru/abc" })),
    );

    await h.trigger.dispatch();

    expect(h.refused).toEqual([]);
    expect(h.started.map((taken) => taken.platform)).toEqual(["kontur"]);
  });

  it.each([
    ["zoom", /Zoom/u, /Zoom/u],
    ["teams", /«teams»/u, /«teams»/u],
  ])(
    "площадка %s — контейнер не поднят, человеку громкий отказ на EN и RU",
    async (platform, en, ru) => {
      const h = harness();
      h.batches.push(batch(invite({ platform, join_url: "https://zoom.us/j/123" })));

      await h.trigger.dispatch();

      expect(h.started).toEqual([]);
      expect(h.refused).toHaveLength(1);
      const detail = h.refused[0]?.detail ?? "";
      expect(detail).toMatch(en);
      expect(detail).toMatch(ru);
      expect(detail).toMatch(/Google Meet и Контур\.Толк/u);
      expect(detail).toMatch(/Google Meet and Kontur\.Talk/u);
      expect(h.lines.join("\n")).toMatch(/ОТКАЗ.*inv-1/u);
    },
  );

  it("контейнер не поднялся — человеку отказ с причиной", async () => {
    const h = harness();
    h.failStart = new Error("no such image");
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();

    expect(h.refused).toHaveLength(1);
    expect(h.refused[0]?.detail).toContain("no such image");
  });

  it("контейнер умер до заявки — человеку отказ, а не тишина (#654)", async () => {
    const h = harness();
    h.exit = { kind: "died", meetingId: null, exitCode: 137 };
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.settled();

    expect(h.refused).toHaveLength(1);
    expect(h.refused[0]?.detail).toMatch(/crashed before joining.*137/u);
    expect(h.refused[0]?.detail).toMatch(/позовите его ещё раз/u);
  });

  it.each([
    [
      "умер после заявки — нотису шлёт оркестратор",
      { kind: "died", meetingId: "m-1", exitCode: 1 },
    ],
    ["встреча закончилась штатно", { kind: "finished" }],
  ] as const)("%s — второго отказа нет", async (_name, exit) => {
    const h = harness();
    h.exit = exit;
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.settled();

    expect(h.refused).toEqual([]);
  });

  it("выход контейнера не узнать — журнал, отказа нет", async () => {
    const h = harness();
    h.failExit = new Error("docker gone");
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.settled();

    expect(h.refused).toEqual([]);
    expect(h.lines.join("\n")).toMatch(/выход контейнера c-inv-1 не узнать: .*docker gone/u);
  });

  it("ожидание выхода не подключено — бот поднят, следить не за чем", async () => {
    const h = harness(false);
    h.batches.push(batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.settled();

    expect(h.started).toHaveLength(1);
    expect(h.refused).toEqual([]);
  });

  it("отказ не доставлен — громко в журнал и ошибка для повтора", async () => {
    const h = harness();
    h.failRefuse = new Error("meeting-notice 500");
    h.batches.push(batch(invite({ id: "k", platform: "zoom" }), invite({ id: "m" })));

    await expect(h.trigger.dispatch()).rejects.toThrow("meeting-notice 500");

    const lost = h.lines.find((line) => line.startsWith("ОТКАЗ НЕ ДОСТАВЛЕН по приглашению k:"));
    expect(lost).toContain("meeting-notice 500");
    expect(h.started).toEqual([]);
  });

  it("одно приглашение не поднимает двух ботов, даже если пришло повторно", async () => {
    const h = harness();
    h.batches.push(batch(invite(), invite()), batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.dispatch();

    expect(h.started).toHaveLength(1);
    expect(h.lines.join("\n")).toMatch(/inv-1.*повторно/u);
  });

  it("память о запущенных чистится по сроку приглашения", async () => {
    const h = harness();
    h.batches.push(batch(invite({ expires_at: "2000-01-01T00:00:00.000Z" })), batch(invite()));

    await h.trigger.dispatch();
    await h.trigger.dispatch();

    expect(h.trigger.rememberedCount).toBe(1);
  });

  it("сбой забора не подтверждается и доступен для повтора", async () => {
    const h = harness();
    h.failTake = new Error("meeting-invite 503");

    await expect(h.trigger.dispatch()).rejects.toThrow("meeting-invite 503");

    expect(h.lines.join("\n")).toMatch(/забор приглашения не удался.*meeting-invite 503/u);
  });

  it("кривое приглашение в пачке — громко: оно уже забрано и потеряно", async () => {
    const h = harness();
    h.batches.push({ invites: [invite()], malformed: ["invites[1] (inv-9): нет platform"] });

    await h.trigger.dispatch();

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
    const detail = refusalDetail({ kind: "platform", platform: "zoom" });

    expect(detail.length).toBeLessThanOrEqual(MAX_REFUSAL_DETAIL_CHARS);
  });
});
