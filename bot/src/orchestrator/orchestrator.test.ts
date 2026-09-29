/**
 * Правила оркестратора на двойнике Docker: смерть видна, сирот не остаётся, чужое не
 * трогается, кривой запуск отвергается до подъёма контейнера.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_STATE_TARGET, type AccountCopies } from "./account.ts";
import type { MeetingEgress, MeetingNetwork } from "./egress.ts";
import type { ContainerEngine, ContainerSpec, EngineContainer } from "./engine.ts";
import { readLease } from "./lease.ts";
import type { Notice, NoticeResult } from "./notices.ts";
import {
  LABEL,
  Orchestrator,
  type OrchestratorOptions,
  STOP_GRACE_SECONDS,
} from "./orchestrator.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- lib проекта ES2023, withResolvers там нет
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  if (resolve === undefined) throw new Error("executor Promise отработал не синхронно");
  return { promise, resolve };
}

async function replaceWithFile(target: string, attempts = 20): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true });
    await writeFile(target, "not a directory");
  } catch (error) {
    if (attempts <= 1) throw error;
    await replaceWithFile(target, attempts - 1);
  }
}

function environmentOf(spec: ContainerSpec | undefined): string[] {
  return [...(spec?.env ?? [])];
}

class FakeAccount implements AccountCopies {
  readonly calls: string[] = [];
  hasSignIn = true;
  shouldFail = false;
  shouldFailRelease = false;

  prepare(runId: string): Promise<string | null> {
    this.calls.push(`prepare:${runId}`);
    if (this.shouldFail)
      return Promise.reject(new Error("the bot's saved Google sign-in is damaged"));
    return Promise.resolve(this.hasSignIn ? `/copies/${runId}.json` : null);
  }

  release(runId: string): Promise<void> {
    this.calls.push(`release:${runId}`);
    return this.shouldFailRelease ? Promise.reject(new Error("EBUSY")) : Promise.resolve();
  }

  sweep(liveRunIds: ReadonlySet<string>): Promise<void> {
    this.calls.push(`sweep:${[...liveRunIds].join(",")}`);
    return Promise.resolve();
  }
}

// Схема собирается из кусков: `eslint --fix` переписал бы литерал в https (см. url.test.ts).
const PROXY_URL = `${["ht", "tp:"].join("")}//egress:3128`;

class FakeEgress implements MeetingEgress {
  readonly calls: string[] = [];
  shouldFailPrepare = false;
  shouldFailRelease = false;
  shouldFailSweep = false;

  prepare(runId: string): Promise<MeetingNetwork> {
    this.calls.push(`prepare:${runId}`);
    if (this.shouldFailPrepare) return Promise.reject(new Error("egress-прокси не стартовал"));
    return Promise.resolve({ network: `net-${runId}`, proxyUrl: PROXY_URL });
  }

  release(runId: string): Promise<void> {
    this.calls.push(`release:${runId}`);
    return this.shouldFailRelease
      ? Promise.reject(new Error("active endpoints"))
      : Promise.resolve();
  }

  sweep(liveRunIds: ReadonlySet<string>): Promise<void> {
    this.calls.push(`sweep:${[...liveRunIds].join(",")}`);
    return this.shouldFailSweep ? Promise.reject(new Error("docker down")) : Promise.resolve();
  }
}

class FakeEngine implements ContainerEngine {
  private next = 0;
  readonly calls: string[] = [];
  readonly specs: ContainerSpec[] = [];
  readonly exits = new Map<string, Deferred<number | null>>();
  readonly logs = new Map<string, (line: string) => void>();
  existing: EngineContainer[] = [];
  shouldFailStart = false;
  shouldFailRemove = false;
  shouldFailLogs = false;
  shouldFailWait = false;

  private exitOf(id: string): Deferred<number | null> {
    let exit = this.exits.get(id);
    if (exit === undefined) {
      exit = deferred<number | null>();
      this.exits.set(id, exit);
    }
    return exit;
  }

  create(spec: ContainerSpec): Promise<string> {
    this.next += 1;
    const id = `c${String(this.next)}`;
    this.specs.push(spec);
    this.calls.push(`create:${id}`);
    return Promise.resolve(id);
  }

  start(id: string): Promise<void> {
    this.calls.push(`start:${id}`);
    return this.shouldFailStart ? Promise.reject(new Error("no such image")) : Promise.resolve();
  }

  waitExit(id: string, condition: string): Promise<number | null> {
    this.calls.push(`wait:${id}:${condition}`);
    if (this.shouldFailWait) return Promise.reject(new Error("socket hang up"));
    return this.exitOf(id).promise;
  }

  stop(id: string, graceSeconds: number): Promise<void> {
    this.calls.push(`stop:${id}:${String(graceSeconds)}`);
    this.exitOf(id).resolve(0);
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.calls.push(`remove:${id}`);
    return this.shouldFailRemove ? Promise.reject(new Error("busy")) : Promise.resolve();
  }

  listByLabel(label: string, value: string): Promise<EngineContainer[]> {
    this.calls.push(`list:${label}=${value}`);
    return Promise.resolve(this.existing);
  }

  followLogs(id: string, onLine: (line: string) => void): Promise<void> {
    this.logs.set(id, onLine);
    return this.shouldFailLogs ? Promise.reject(new Error("no logs")) : Promise.resolve();
  }

  say(id: string, line: string): void {
    this.logs.get(id)?.(line);
  }

  exit(id: string, code: number | null): void {
    this.exitOf(id).resolve(code);
  }
}

describe("оркестратор", () => {
  let leaseDirectory: string;
  let engine: FakeEngine;
  let egress: FakeEgress;
  let notices: Notice[];
  let recipients: number[];
  let noticeTokens: string[];
  let orchestrator: Orchestrator;

  function build(
    extraEnvironment?: Record<string, string>,
    isolation: Partial<Pick<OrchestratorOptions, "maxMeetings" | "limits" | "account">> = {},
  ): Orchestrator {
    return new Orchestrator({
      egress,
      ...isolation,
      engine,
      project: "scriba-test",
      image: "scriba:dev",
      leaseDirectory,
      swarmUrl: "https://swarm.example/functions/v1",
      token: "bot-token",
      version: 7,
      notifierFor: (onBehalfOf, token) => ({
        notify: (notice): Promise<NoticeResult> => {
          notices.push(notice);
          recipients.push(onBehalfOf);
          noticeTokens.push(token);
          return Promise.resolve({ delivered: true, shouldLeave: false });
        },
      }),
      log: (): void => {
        // журнал оркестратора в тестах не нужен
      },
      leaseIntervalMs: 20,
      newRunId: () => "run-1",
      ...(extraEnvironment && { extraEnv: extraEnvironment }),
    });
  }

  beforeEach(async () => {
    leaseDirectory = await mkdtemp(path.join(tmpdir(), "scriba-orch-"));
    engine = new FakeEngine();
    egress = new FakeEgress();
    notices = [];
    recipients = [];
    noticeTokens = [];
    orchestrator = build();
  });

  afterEach(async () => {
    orchestrator.close();
    // close() гасит таймер, но уже начатая запись поводка ещё может положить временный файл,
    // пока каталог сносится: без повтора уборка изредка падает на ENOTEMPTY.
    await rm(leaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  const MEET = "https://meet.google.com/abc-defg-hij";

  describe("startForMeeting", () => {
    it("поднимает контейнер с окружением встречи, меткой проекта, томом и поводком", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(id).toBe("c1");
      const spec = engine.specs[0];
      expect(spec?.name).toBe("scriba-test-meeting-run-1");
      expect(spec?.labels).toMatchObject({
        [LABEL.project]: "scriba-test",
        [LABEL.run]: "run-1",
        [LABEL.onBehalfOf]: "744",
      });
      expect(spec?.env).toEqual(
        expect.arrayContaining([
          "SCRIBA_JOIN_URL=https://meet.google.com/abc-defg-hij?hl=en",
          "SCRIBA_ON_BEHALF_OF=744",
          "SCRIBA_BOT_TOKEN=bot-token",
          "SCRIBA_RUN_ID=run-1",
          "SCRIBA_LEASE_DIR=/lease",
        ]),
      );
      expect(spec?.volume).toEqual({ name: "scriba-test-recordings-744", target: "/recordings" });
      expect(spec?.readOnlyBind).toEqual({ source: leaseDirectory, target: "/lease" });
      expect(orchestrator.list()).toEqual([
        { id: "c1", runId: "run-1", onBehalfOf: 744, meetingId: null },
      ]);
    });

    it("приглашение из веба едет в окружение и метку контейнера — бот предъявит его в claim", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744, {
        id: "inv-1",
        joinUrl: MEET,
      });

      const spec = engine.specs[0];
      expect(spec?.env).toEqual(
        expect.arrayContaining([`SCRIBA_INVITE_ID=inv-1`, `SCRIBA_INVITE_JOIN_URL=${MEET}`]),
      );
      expect(spec?.labels[LABEL.invite]).toBe("inv-1");
    });

    it("без приглашения переменных и метки приглашения нет", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744);

      const spec = engine.specs[0];
      expect(spec?.env.some((line) => line.startsWith("SCRIBA_INVITE_"))).toBe(false);
      expect(spec?.labels).not.toHaveProperty(LABEL.invite);
    });

    it("событие календаря едет в окружение ключом и началом, метка scriba.calendar, приглашения нет", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744, {
        calendarKey: "evt-1:2026-09-28",
        startsAt: "2026-09-28T10:00:00.000Z",
      });

      const spec = engine.specs[0];
      expect(spec?.env).toEqual(
        expect.arrayContaining([
          "SCRIBA_CALENDAR_KEY=evt-1:2026-09-28",
          "SCRIBA_CALENDAR_STARTS_AT=2026-09-28T10:00:00.000Z",
        ]),
      );
      expect(spec?.env.some((line) => line.startsWith("SCRIBA_INVITE_"))).toBe(false);
      expect(spec?.labels[LABEL.calendar]).toBe("evt-1:2026-09-28");
      expect(spec?.labels).not.toHaveProperty(LABEL.invite);
    });

    it("ожидание выхода регистрируется ДО старта: авто-удалённый контейнер иначе потерял бы код", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(engine.calls).toEqual(["create:c1", "wait:c1:next-exit", "start:c1"]);
    });

    it("ручки смоука не перекрывают обязательные переменные", async () => {
      orchestrator = build({ SCRIBA_BOT_TOKEN: "stolen", SCRIBA_ALONE_MS: "5000" });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      const environment = engine.specs[0]?.env ?? [];
      expect(environment).toContain("SCRIBA_BOT_TOKEN=bot-token");
      expect(environment).not.toContain("SCRIBA_BOT_TOKEN=stolen");
      expect(environment).toContain("SCRIBA_ALONE_MS=5000");
    });

    it.each([
      ["площадка без адаптера", MEET, "zoom", 744, /не поддерживается/u],
      ["чужой хост", "https://evil.example/abc", "meet", 744, /meet\.google\.com/u],
      ["не https", ["http", "://meet.google.com/abc"].join(""), "meet", 744, /https/u],
      ["не человек", MEET, "meet", 0, /telegram id/u],
      ["дробный id", MEET, "meet", 1.5, /telegram id/u],
    ])("%s — отказ до подъёма контейнера", async (_what, url, platform, person, message) => {
      await expect(orchestrator.startForMeeting(url, platform, person)).rejects.toThrow(message);
      expect(engine.calls).toEqual([]);
    });

    it("контейнер не стартовал — убран, а не брошен", async () => {
      engine.shouldFailStart = true;

      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow(
        /не стартовал/u,
      );
      expect(engine.calls).toContain("remove:c1");
      expect(orchestrator.list()).toEqual([]);
    });
  });

  describe("изоляция встреч друг от друга и от хоста", () => {
    it("у каждого человека свой том записей: чужая очередь выгрузки контейнеру не видна", async () => {
      let run = 0;
      orchestrator = new Orchestrator({
        egress,
        engine,
        project: "scriba-test",
        image: "scriba:dev",
        leaseDirectory,
        swarmUrl: "https://swarm.example/functions/v1",
        token: "bot-token",
        version: 7,
        notifierFor: () => ({
          notify: (): Promise<NoticeResult> =>
            Promise.resolve({ delivered: true, shouldLeave: false }),
        }),
        log: (): void => {
          // журнал оркестратора в тестах не нужен
        },
        newRunId: () => {
          run += 1;
          return `run-${String(run)}`;
        },
      });

      await orchestrator.startForMeeting(MEET, "meet", 744);
      await orchestrator.startForMeeting(MEET, "meet", 745);
      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(engine.specs.map((spec) => spec.volume.name)).toEqual([
        "scriba-test-recordings-744",
        "scriba-test-recordings-745",
        // Тот же человек — тот же том: осиротевшую запись подберёт его следующий запуск.
        "scriba-test-recordings-744",
      ]);
    });

    it("потолок одновременных встреч: сверх него — громкий отказ, и контейнер не создаётся", async () => {
      orchestrator = build(undefined, { maxMeetings: 2 });
      await orchestrator.startForMeeting(MEET, "meet", 744);
      await orchestrator.startForMeeting(MEET, "meet", 745);

      await expect(orchestrator.startForMeeting(MEET, "meet", 746)).rejects.toThrow(
        /2 of 2 meeting slots/,
      );
      expect(engine.specs).toHaveLength(2);
    });

    it("одновременные запуски не проскакивают потолок, пока первый ещё создаётся", async () => {
      orchestrator = build(undefined, { maxMeetings: 2 });

      const results = await Promise.allSettled([
        orchestrator.startForMeeting(MEET, "meet", 744),
        orchestrator.startForMeeting(MEET, "meet", 745),
        orchestrator.startForMeeting(MEET, "meet", 746),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "rejected",
      ]);
      expect(engine.specs).toHaveLength(2);
    });

    it("место освобождается, когда встреча кончилась или контейнер не стартовал", async () => {
      orchestrator = build(undefined, { maxMeetings: 1 });
      engine.shouldFailStart = true;
      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow(/не стартовал/);
      engine.shouldFailStart = false;

      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 0);
      await orchestrator.whenExited(id);

      await expect(orchestrator.startForMeeting(MEET, "meet", 745)).resolves.toBe("c3");
    });

    it("подхваченные после перезапуска контейнеры занимают места под потолком", async () => {
      engine.existing = [
        { id: "old-1", running: true, labels: { [LABEL.run]: "r0", [LABEL.onBehalfOf]: "744" } },
      ];
      orchestrator = build(undefined, { maxMeetings: 1 });
      await orchestrator.init();

      await expect(orchestrator.startForMeeting(MEET, "meet", 745)).rejects.toThrow(/1 of 1/);
    });

    it("контейнеру заданы потолки памяти, процессора и процессов", async () => {
      const limits = { memoryBytes: 512 * 1024 * 1024, nanoCpus: 1_500_000_000, pids: 300 };
      orchestrator = build(undefined, { limits });
      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(engine.specs[0]?.limits).toEqual(limits);
    });

    it("по умолчанию потолки тоже есть — не «без ограничений»", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744);

      const limits = engine.specs[0]?.limits;
      expect(limits?.memoryBytes).toBeGreaterThan(0);
      expect(limits?.nanoCpus).toBeGreaterThan(0);
      expect(limits?.pids).toBeGreaterThan(0);
    });

    it("профиль seccomp едет в контейнер и разрешает песочнице Chromium её пространства имён", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744);

      const profile = JSON.parse(engine.specs[0]?.seccompProfile ?? "{}") as {
        defaultAction?: string;
        syscalls?: { names: string[]; action: string; includes?: object }[];
      };
      expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
      const sandboxRule = profile.syscalls?.find(
        (rule) => rule.names.includes("unshare") && rule.includes === undefined,
      );
      expect(sandboxRule?.action).toBe("SCMP_ACT_ALLOW");
    });

    it("кривой потолок — отказ при сборке оркестратора, а не «без ограничений»", () => {
      expect(() => build(undefined, { maxMeetings: 0 })).toThrow(/maxMeetings/);
    });
  });

  describe("смерть контейнера", () => {
    it("штатный выход (0) — исход из журнала, нотисы нет", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.say(id, 'scriba-state {"meetingId":"m-1"}');
      engine.say(id, 'scriba-state {"outcome":"recorded"}');
      engine.exit(id, 0);

      expect(await orchestrator.whenExited(id)).toEqual({ kind: "finished", outcome: "recorded" });
      expect(notices).toEqual([]);
      expect(orchestrator.list()).toEqual([]);
    });

    it("умер посреди встречи — container_died с meeting_id из журнала", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.say(id, "[meet] клик: войти");
      engine.say(id, '[scriba] scriba-state {"meetingId":"m-9"}');
      engine.exit(id, 137);

      expect(await orchestrator.whenExited(id)).toEqual({
        kind: "died",
        exitCode: 137,
        meetingId: "m-9",
      });
      expect(notices).toEqual([{ kind: "container_died", meetingId: "m-9", detail: "exit 137" }]);
      expect(recipients).toEqual([744]);
    });

    it("БЛОКИРУЮЩИЙ (T165): контейнер получает пропуск встречи, а не общий токен агента", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744, {
        calendarKey: "evt-1:2026-09-28",
        startsAt: "2026-09-28T10:00:00.000Z",
        grantToken: "sgr_calendar-pass",
      });
      await orchestrator.startForMeeting(MEET, "meet", 744, {
        id: "inv-1",
        joinUrl: MEET,
        grantToken: "sgr_invite-pass",
      });

      const [calendar, invite] = engine.specs;
      expect(calendar?.env).toContain("SCRIBA_BOT_TOKEN=sgr_calendar-pass");
      expect(invite?.env).toContain("SCRIBA_BOT_TOKEN=sgr_invite-pass");
      for (const spec of engine.specs) {
        expect(spec.env.join("\n")).not.toContain("bot-token");
        expect(Object.values(spec.labels).join("\n")).not.toContain("sgr_");
      }
    });

    it("умер посреди встречи с пропуском — container_died уходит по пропуску этой встречи", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744, {
        id: "inv-1",
        joinUrl: MEET,
        grantToken: "sgr_pass",
      });
      engine.say(id, '[scriba] scriba-state {"meetingId":"m-9"}');
      engine.exit(id, 137);
      await orchestrator.whenExited(id);

      expect(noticeTokens).toEqual(["sgr_pass"]);
    });

    it("умер до claim — нотисе не к чему привязаться, но смерть зафиксирована", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 1);

      expect(await orchestrator.whenExited(id)).toEqual({
        kind: "died",
        exitCode: 1,
        meetingId: null,
      });
      expect(notices).toEqual([]);
    });

    it("код выхода потерян — это смерть, а не штатный конец", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, null);

      const exit = await orchestrator.whenExited(id);
      expect(exit?.kind).toBe("died");
    });

    it("нотиса не ушла — оркестратор не падает", async () => {
      orchestrator = new Orchestrator({
        egress,
        engine,
        project: "scriba-test",
        image: "scriba:dev",
        leaseDirectory,
        swarmUrl: "https://swarm.example",
        token: "t",
        version: 1,
        notifierFor: () => ({ notify: () => Promise.reject(new Error("502")) }),
        log: (): void => {
          // журнал оркестратора в тестах не нужен
        },
      });
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.say(id, 'scriba-state {"meetingId":"m-1"}');
      engine.exit(id, 139);

      const exit = await orchestrator.whenExited(id);
      expect(exit?.kind).toBe("died");
    });
  });

  describe("stop", () => {
    it("SIGTERM с запасом на выгрузку и ожидание выхода", async () => {
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);

      await orchestrator.stop(id);

      expect(engine.calls).toContain(`stop:${id}:${String(STOP_GRACE_SECONDS)}`);
      expect(orchestrator.exitOf(id)).toEqual({ kind: "finished", outcome: null });
    });

    it("чужой или закончившийся контейнер — отказ, а не молчаливое «ок»", async () => {
      await expect(orchestrator.stop("someone-else")).rejects.toThrow(/не наш/u);
    });
  });

  describe("сироты и перезапуск оркестратора", () => {
    it("поводок пишется сразу и двигается, пока оркестратор жив", async () => {
      await orchestrator.init();
      const first = await readLease(leaseDirectory);

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(first).toBe(1);
      expect(await readLease(leaseDirectory)).toBeGreaterThan(1);
    });

    it("после close поводок замирает — контейнеры поймут, что хозяина нет", async () => {
      await orchestrator.init();
      orchestrator.close();
      const frozen = await readLease(leaseDirectory);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(await readLease(leaseDirectory)).toBe(frozen);
    });

    it("на старте: живые контейнеры своего проекта подхвачены, остановленные убраны", async () => {
      engine.existing = [
        { id: "alive", running: true, labels: { [LABEL.run]: "r-old", [LABEL.onBehalfOf]: "744" } },
        { id: "dead", running: false, labels: { [LABEL.run]: "r-dead" } },
      ];

      await orchestrator.init();

      expect(engine.calls).toEqual([
        "list:scriba.project=scriba-test",
        "wait:alive:not-running",
        "remove:dead",
      ]);
      expect(orchestrator.list()).toEqual([
        { id: "alive", runId: "r-old", onBehalfOf: 744, meetingId: null },
      ]);
    });

    it("подхваченный контейнер умер — смерть видна так же, как у своего", async () => {
      engine.existing = [
        { id: "alive", running: true, labels: { [LABEL.run]: "r-old", [LABEL.onBehalfOf]: "744" } },
      ];
      await orchestrator.init();
      engine.say("alive", 'scriba-state {"meetingId":"m-old"}');
      engine.exit("alive", 1);

      expect(await orchestrator.whenExited("alive")).toEqual({
        kind: "died",
        exitCode: 1,
        meetingId: "m-old",
      });
    });
  });

  describe("сбои самого Docker — громко, но без падения оркестратора", () => {
    it("остановленный контейнер не убрался — оркестратор стартует дальше", async () => {
      engine.existing = [{ id: "dead", running: false, labels: {} }];
      engine.shouldFailRemove = true;

      await expect(orchestrator.init()).resolves.toBeUndefined();
      expect(engine.calls).toContain("remove:dead");
    });

    it("журнал не читается — контейнер всё равно под присмотром", async () => {
      engine.shouldFailLogs = true;
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      await new Promise((resolve) => setTimeout(resolve, 5));
      engine.exit(id, 0);

      const exit = await orchestrator.whenExited(id);
      expect(exit?.kind).toBe("finished");
    });

    it("ожидание выхода сорвалось — это смерть, а не тишина", async () => {
      engine.shouldFailWait = true;
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(await orchestrator.whenExited(id)).toMatchObject({ kind: "died", exitCode: null });
    });

    it("поводок не пишется — оркестратор не падает, а говорит об этом", async () => {
      const lines: string[] = [];
      orchestrator = new Orchestrator({
        egress,
        engine,
        project: "scriba-test",
        image: "scriba:dev",
        leaseDirectory,
        swarmUrl: "https://swarm.example",
        token: "t",
        version: 1,
        notifierFor: () => ({
          notify: () => Promise.resolve({ delivered: true, shouldLeave: false }),
        }),
        log: (line) => {
          lines.push(line);
        },
        leaseIntervalMs: 10,
      });
      await orchestrator.init();
      // Каталог поводка подменён файлом: следующая запись обязана упасть. Таймер поводка
      // (10 мс) может успеть пересоздать каталог между rm и writeFile — тогда подмена
      // повторяется; на нагруженной машине это ловилось как EISDIR.
      await replaceWithFile(leaseDirectory);
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(lines.some((line) => line.includes("поводок не записан"))).toBe(true);
    });

    it("журнал по умолчанию — в консоль", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {
        // консоль в тестах глушим
      });
      orchestrator = new Orchestrator({
        egress,
        engine,
        project: "scriba-test",
        image: "scriba:dev",
        leaseDirectory,
        swarmUrl: "https://swarm.example",
        token: "t",
        version: 1,
        notifierFor: () => ({
          notify: () => Promise.resolve({ delivered: true, shouldLeave: false }),
        }),
      });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("выход встречи наружу (T178)", () => {
    it("контейнер встаёт в свою сеть встречи и ходит только через прокси — браузер и node", async () => {
      await orchestrator.startForMeeting(MEET, "meet", 744);

      const spec = engine.specs[0];
      expect(egress.calls).toEqual(["prepare:run-1"]);
      expect(spec?.network).toBe("net-run-1");
      expect(environmentOf(spec)).toEqual(
        expect.arrayContaining([
          `SCRIBA_EGRESS_PROXY=${PROXY_URL}`,
          `HTTPS_PROXY=${PROXY_URL}`,
          `HTTP_PROXY=${PROXY_URL}`,
          "NODE_USE_ENV_PROXY=1",
        ]),
      );
    });

    it("ручки смоука не снимают прокси", async () => {
      orchestrator = build({ HTTPS_PROXY: "", SCRIBA_EGRESS_PROXY: "", NODE_USE_ENV_PROXY: "0" });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(environmentOf(engine.specs[0])).toEqual(
        expect.arrayContaining([
          `SCRIBA_EGRESS_PROXY=${PROXY_URL}`,
          `HTTPS_PROXY=${PROXY_URL}`,
          "NODE_USE_ENV_PROXY=1",
        ]),
      );
    });

    it("сеть встречи не поднялась — контейнера нет, копия входа убрана, место свободно", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account, maxMeetings: 1 });
      egress.shouldFailPrepare = true;

      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow(/egress/u);
      expect(engine.specs).toEqual([]);
      expect(account.calls).toContain("release:run-1");

      egress.shouldFailPrepare = false;
      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).resolves.toBe("c1");
    });

    it("контейнер не стартовал — сеть встречи убрана", async () => {
      engine.shouldFailStart = true;

      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow();
      expect(egress.calls).toEqual(["prepare:run-1", "release:run-1"]);
    });

    it("встреча кончилась или контейнер умер — сеть встречи убрана", async () => {
      const first = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(first, 0);
      await orchestrator.whenExited(first);
      const second = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(second, 137);
      await orchestrator.whenExited(second);

      expect(egress.calls.filter((call) => call.startsWith("release:"))).toHaveLength(2);
    });

    it("сеть не убралась — это строка журнала, а не падение разбора выхода", async () => {
      egress.shouldFailRelease = true;
      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 0);

      await expect(orchestrator.whenExited(id)).resolves.toMatchObject({ kind: "finished" });
    });

    it("старт службы разбирает сети встреч по живым запускам; сбой разбора службу не роняет", async () => {
      engine.existing = [
        {
          id: "old",
          running: true,
          labels: {
            [LABEL.project]: "scriba-test",
            [LABEL.run]: "run-old",
            [LABEL.onBehalfOf]: "744",
          },
        },
      ];
      egress.shouldFailSweep = true;
      orchestrator.close();
      orchestrator = build();

      await expect(orchestrator.init()).resolves.toBeUndefined();
      expect(egress.calls).toContain("sweep:run-old");
    });
  });

  describe("вход аккаунта бота (T175)", () => {
    it("вход сохранён — в контейнер едет своя копия одним файлом на чтение и путь к ней", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      const spec = engine.specs[0];
      expect(account.calls).toEqual(["prepare:run-1"]);
      expect(spec?.accountState).toEqual({
        source: "/copies/run-1.json",
        target: ACCOUNT_STATE_TARGET,
      });
      expect(environmentOf(spec)).toContain(`SCRIBA_GOOGLE_STATE=${ACCOUNT_STATE_TARGET}`);
    });

    it("входа нет — контейнер идёт гостем: ни монтирования, ни переменной", async () => {
      const account = new FakeAccount();
      account.hasSignIn = false;
      orchestrator = build(undefined, { account });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      const spec = engine.specs[0];
      expect(spec?.accountState).toBeUndefined();
      expect(environmentOf(spec).some((line) => line.startsWith("SCRIBA_GOOGLE_STATE="))).toBe(
        false,
      );
    });

    it("ручки смоука не подменяют путь к входу", async () => {
      const account = new FakeAccount();
      orchestrator = build({ SCRIBA_GOOGLE_STATE: "/elsewhere.json" }, { account });

      await orchestrator.startForMeeting(MEET, "meet", 744);

      expect(environmentOf(engine.specs[0])).toContain(
        `SCRIBA_GOOGLE_STATE=${ACCOUNT_STATE_TARGET}`,
      );
      expect(environmentOf(engine.specs[0])).not.toContain("SCRIBA_GOOGLE_STATE=/elsewhere.json");
    });

    it("испорченный вход — громкий отказ до подъёма контейнера, место освобождено", async () => {
      const account = new FakeAccount();
      account.shouldFail = true;
      orchestrator = build(undefined, { account, maxMeetings: 1 });

      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow(/sign-in/u);
      expect(engine.specs).toEqual([]);

      account.shouldFail = false;
      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).resolves.toBe("c1");
    });

    it("контейнер закончил встречу — копия входа убрана", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 0);
      await orchestrator.whenExited(id);

      expect(account.calls).toContain("release:run-1");
    });

    it("контейнер умер — копия входа тоже убрана", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 137);
      await orchestrator.whenExited(id);

      expect(account.calls).toContain("release:run-1");
    });

    it("копия не убралась — выход контейнера всё равно учтён, оркестратор не падает", async () => {
      const account = new FakeAccount();
      account.shouldFailRelease = true;
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744);
      engine.exit(id, 0);

      expect(await orchestrator.whenExited(id)).toEqual({ kind: "finished", outcome: null });
    });

    it("контейнер не стартовал — копия убрана вместе с ним", async () => {
      const account = new FakeAccount();
      engine.shouldFailStart = true;
      orchestrator = build(undefined, { account });

      await expect(orchestrator.startForMeeting(MEET, "meet", 744)).rejects.toThrow();

      expect(account.calls).toEqual(["prepare:run-1", "release:run-1"]);
    });

    it("на старте копии упавшего оркестратора убираются, копии подхваченных живых — нет", async () => {
      const account = new FakeAccount();
      engine.existing = [
        {
          id: "old",
          running: true,
          labels: { [LABEL.run]: "run-alive", [LABEL.onBehalfOf]: "744" },
        },
      ];
      orchestrator = build(undefined, { account });

      await orchestrator.init();

      expect(account.calls).toEqual(["sweep:run-alive"]);
    });
  });
});
