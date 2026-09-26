/**
 * Правила оркестратора на двойнике Docker: смерть видна, сирот не остаётся, чужое не
 * трогается, кривой запуск отвергается до подъёма контейнера.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContainerEngine, ContainerSpec, EngineContainer } from "./engine.ts";
import { readLease } from "./lease.ts";
import type { Notice, NoticeResult } from "./notices.ts";
import { LABEL, Orchestrator, STOP_GRACE_SECONDS } from "./orchestrator.ts";

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
  let notices: Notice[];
  let recipients: number[];
  let orchestrator: Orchestrator;

  function build(extraEnvironment?: Record<string, string>): Orchestrator {
    return new Orchestrator({
      engine,
      project: "scriba-test",
      image: "scriba:dev",
      leaseDirectory,
      swarmUrl: "https://swarm.example/functions/v1",
      token: "bot-token",
      version: 7,
      notifierFor: (onBehalfOf) => ({
        notify: (notice): Promise<NoticeResult> => {
          notices.push(notice);
          recipients.push(onBehalfOf);
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
    notices = [];
    recipients = [];
    orchestrator = build();
  });

  afterEach(async () => {
    orchestrator.close();
    await rm(leaseDirectory, { recursive: true, force: true });
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
      expect(spec?.volume).toEqual({ name: "scriba-test-recordings", target: "/recordings" });
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
      // Каталог поводка подменён файлом: следующая запись обязана упасть.
      await rm(leaseDirectory, { recursive: true, force: true });
      await writeFile(leaseDirectory, "not a directory");
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(lines.some((line) => line.includes("поводок не записан"))).toBe(true);
    });

    it("журнал по умолчанию — в консоль", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {
        // консоль в тестах глушим
      });
      orchestrator = new Orchestrator({
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
});
