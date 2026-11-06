import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_STATE_TARGET } from "./account.ts";
import { LoginWatch } from "./login-watch.ts";
import type { NoticeResult } from "./notices.ts";
import { LABEL, Orchestrator, type OrchestratorOptions } from "./orchestrator.ts";
import {
  environmentOf,
  FakeAccount,
  NoticeCapture,
  FakeEgress,
  FakeEngine,
  finishProbe,
  settle,
  PASS,
} from "../../test-support/orchestrator.ts";

describe("оркестратор", () => {
  let leaseDirectory: string;
  let engine: FakeEngine;
  let egress: FakeEgress;
  let orchestrator: Orchestrator;
  let capture: NoticeCapture;

  function build(
    extraEnvironment?: Record<string, string>,
    isolation: Partial<
      Pick<OrchestratorOptions, "maxMeetings" | "limits" | "account" | "loginKeepalive">
    > = {},
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
      notifierFor: capture.forRecipient,
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
    capture = new NoticeCapture();
    orchestrator = build();
  });

  afterEach(async () => {
    orchestrator.close();
    // close() гасит таймер, но уже начатая запись поводка ещё может положить временный файл,
    // пока каталог сносится: без повтора уборка изредка падает на ENOTEMPTY.
    await rm(leaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  const MEET = "https://meet.google.com/abc-defg-hij";

  describe("вход аккаунта бота (T175)", () => {
    it("вход сохранён — в контейнер едет своя копия одним файлом на чтение и путь к ней", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      await orchestrator.startForMeeting(MEET, "meet", 744, PASS);

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

      await orchestrator.startForMeeting(MEET, "meet", 744, PASS);

      const spec = engine.specs[0];
      expect(spec?.accountState).toBeUndefined();
      expect(environmentOf(spec).some((line) => line.startsWith("SCRIBA_GOOGLE_STATE="))).toBe(
        false,
      );
    });

    it("ручки смоука не подменяют путь к входу", async () => {
      const account = new FakeAccount();
      orchestrator = build({ SCRIBA_GOOGLE_STATE: "/elsewhere.json" }, { account });

      await orchestrator.startForMeeting(MEET, "meet", 744, PASS);

      expect(environmentOf(engine.specs[0])).toContain(
        `SCRIBA_GOOGLE_STATE=${ACCOUNT_STATE_TARGET}`,
      );
      expect(environmentOf(engine.specs[0])).not.toContain("SCRIBA_GOOGLE_STATE=/elsewhere.json");
    });

    it("испорченный вход — громкий отказ до подъёма контейнера, место освобождено", async () => {
      const account = new FakeAccount();
      account.shouldFail = true;
      orchestrator = build(undefined, { account, maxMeetings: 1 });

      await expect(orchestrator.startForMeeting(MEET, "meet", 744, PASS)).rejects.toThrow(
        /sign-in/u,
      );
      expect(engine.specs).toEqual([]);

      account.shouldFail = false;
      await expect(orchestrator.startForMeeting(MEET, "meet", 744, PASS)).resolves.toBe("c1");
    });

    it("контейнер закончил встречу — копия входа убрана", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
      engine.exit(id, 0);
      await orchestrator.whenExited(id);

      expect(account.calls).toContain("release:run-1");
    });

    it("контейнер умер — копия входа тоже убрана", async () => {
      const account = new FakeAccount();
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
      engine.exit(id, 137);
      await orchestrator.whenExited(id);

      expect(account.calls).toContain("release:run-1");
    });

    it("копия не убралась — выход контейнера всё равно учтён, оркестратор не падает", async () => {
      const account = new FakeAccount();
      account.shouldFailRelease = true;
      orchestrator = build(undefined, { account });

      const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
      engine.exit(id, 0);

      expect(await orchestrator.whenExited(id)).toEqual({ kind: "finished", outcome: null });
    });

    it("контейнер не стартовал — копия убрана вместе с ним", async () => {
      const account = new FakeAccount();
      engine.shouldFailStart = true;
      orchestrator = build(undefined, { account });

      await expect(orchestrator.startForMeeting(MEET, "meet", 744, PASS)).rejects.toThrow();

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
  describe("продление входа аккаунта бота (#1140)", () => {
    const VALID = JSON.stringify({
      cookies: [{ name: "SID", value: "fresh", domain: ".google.com", path: "/" }],
      origins: [],
    });
    const OLD = JSON.stringify({
      cookies: [{ name: "SID", value: "old", domain: ".google.com", path: "/" }],
      origins: [],
    });
    let account: FakeAccount;
    let stateFile: string;
    let sent: string[];
    let watch: LoginWatch;

    async function keepalive(): Promise<Orchestrator> {
      account = new FakeAccount();
      stateFile = path.join(leaseDirectory, "google-state.json");
      await writeFile(stateFile, OLD);
      sent = [];
      watch = new LoginWatch({
        file: path.join(leaseDirectory, "login-status.json"),
        send: (text) => {
          sent.push(text);
          return Promise.resolve();
        },
        log: (): void => undefined,
      });
      return build(undefined, { account, loginKeepalive: { stateFile, watch } });
    }

    it("встреча кончилась, выгрузка годная — вход заменён, предыдущий рядом, тишина в канале", async () => {
      orchestrator = await keepalive();
      account.output = VALID;
      const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
      expect(engine.specs[0]?.accountOutput).toEqual({
        source: "/copies/run-1.out",
        target: "/run/scriba-account-out",
      });
      expect(environmentOf(engine.specs[0])).toContain(
        "SCRIBA_GOOGLE_STATE_OUT=/run/scriba-account-out/google-state.json",
      );

      engine.say(id, 'scriba-state {"outcome":"door_timeout"}');
      engine.exit(id, 0);
      await orchestrator.whenExited(id);

      expect(await readFile(stateFile, "utf8")).toBe(VALID);
      expect(await readFile(path.join(leaseDirectory, "google-state.prev.json"), "utf8")).toBe(OLD);
      expect(sent).toEqual([]);
    });

    it("signin_required — вход не заменяется, владельцу уходит одно сообщение", async () => {
      orchestrator = await keepalive();
      account.output = VALID;
      const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);

      engine.say(id, "meet: дверь: signin_required — Google просит вход: «verify it's you»");
      engine.say(id, 'scriba-state {"outcome":"account_signin_required"}');
      engine.exit(id, 0);
      await orchestrator.whenExited(id);

      expect(await readFile(stateFile, "utf8")).toBe(OLD);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("Причина: Google просит вход: «verify it's you»");
    });

    it("проба: контейнер без встречи, удачная выгрузка продлевает вход и ничего не шлёт", async () => {
      orchestrator = await keepalive();
      account.output = VALID;

      expect(await orchestrator.runProbe()).toBe(true);
      expect(engine.specs[0]?.command).toEqual(["node", "/app/src/orchestrator/probe-main.ts"]);
      expect(orchestrator.list()).toEqual([]);
      engine.say("c1", 'scriba-state {"outcome":"probe_ok"}');
      engine.exit("c1", 0);
      await orchestrator.whenExited("c1");

      expect(await readFile(stateFile, "utf8")).toBe(VALID);
      expect(watch.status.lastOkAt).not.toBeNull();
      expect(watch.status.lastProbeAt).not.toBeNull();
      expect(sent).toEqual([]);
    });

    it("пробе не отдаём место встречи: все места заняты — пробы нет", async () => {
      orchestrator = await keepalive();
      orchestrator = build(undefined, {
        account,
        maxMeetings: 1,
        loginKeepalive: { stateFile, watch },
      });
      await orchestrator.startForMeeting(MEET, "meet", 744, PASS);

      expect(await orchestrator.runProbe()).toBe(false);
      expect(engine.specs).toHaveLength(1);
    });

    describe("отказы", () => {
      it("слежение не настроено — пробы нет", async () => {
        orchestrator = build(undefined, { account: new FakeAccount() });
        expect(await orchestrator.runProbe()).toBe(false);
        expect(engine.specs).toEqual([]);
      });

      it("проба уже идёт — вторую не поднимаем", async () => {
        orchestrator = await keepalive();
        expect(await orchestrator.runProbe()).toBe(true);
        expect(await orchestrator.runProbe()).toBe(false);
        expect(engine.specs).toHaveLength(1);
      });

      it("вход не сохранён — пробовать нечего, тревоги нет", async () => {
        orchestrator = await keepalive();
        account.hasSignIn = false;
        expect(await orchestrator.runProbe()).toBe(false);
        expect(engine.specs).toEqual([]);
        expect(watch.status.probeCrashes).toBe(0);
      });

      it("сеть пробы не поднялась — это сбой пробы, копия убрана, следующая проба возможна", async () => {
        orchestrator = await keepalive();
        egress.shouldFailPrepare = true;
        expect(await orchestrator.runProbe()).toBe(false);
        expect(watch.status.probeCrashes).toBe(1);
        expect(account.calls.some((call) => call.startsWith("release:probe-"))).toBe(true);
        egress.shouldFailPrepare = false;
        expect(await orchestrator.runProbe()).toBe(true);
      });

      it("контейнер пробы не стартовал — сбой пробы, прокси убран", async () => {
        orchestrator = await keepalive();
        engine.shouldFailStart = true;
        expect(await orchestrator.runProbe()).toBe(false);
        expect(watch.status.probeCrashes).toBe(1);
        expect(egress.calls.some((call) => call.startsWith("release:probe-"))).toBe(true);
      });

      it("проба вынесла «слетел» — состояние сломано, владельцу одно сообщение, время пробы записано", async () => {
        orchestrator = await keepalive();
        await orchestrator.runProbe();
        await finishProbe(engine, orchestrator, "account_signin_required");
        expect(watch.status.broken).toBe(true);
        expect(watch.status.lastProbeAt).not.toBeNull();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain("Причина: Google просит вход.");
        expect(await readFile(stateFile, "utf8")).toBe(OLD);
      });

      it("проба закончилась без выгрузки — это сбой пробы, а не «всё хорошо»", async () => {
        orchestrator = await keepalive();
        account.output = null;
        await orchestrator.runProbe();
        await finishProbe(engine, orchestrator, "probe_ok");
        expect(watch.status.probeCrashes).toBe(1);
        expect(watch.status.lastOkAt).toBeNull();
        expect(sent).toEqual([]);
      });

      it("встреча кончилась без выгрузки — вход цел, состояние не меняется", async () => {
        orchestrator = await keepalive();
        account.output = null;
        const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
        engine.say(id, 'scriba-state {"outcome":"door_timeout"}');
        engine.exit(id, 0);
        await orchestrator.whenExited(id);
        expect(await readFile(stateFile, "utf8")).toBe(OLD);
        expect(watch.status.lastOkAt).toBeNull();
      });

      it("выгрузка другого аккаунта отклонена, вход цел", async () => {
        orchestrator = await keepalive();
        account.output = JSON.stringify({
          cookies: [{ name: "HSID", value: "x", domain: ".google.com", path: "/" }],
        });
        const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
        engine.say(id, 'scriba-state {"outcome":"recorded"}');
        engine.exit(id, 0);
        await orchestrator.whenExited(id);
        expect(await readFile(stateFile, "utf8")).toBe(OLD);
        expect(watch.status.lastOkAt).toBeNull();
      });

      it("файл входа не записывается — громкая строка, разбор выхода идёт дальше", async () => {
        const lines: string[] = [];
        orchestrator = await keepalive();
        const broken = path.join(leaseDirectory, "no-such-dir", "google-state.json");
        orchestrator = new Orchestrator({
          egress,
          engine,
          account,
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
          log: (line) => {
            lines.push(line);
          },
          leaseIntervalMs: 20,
          newRunId: () => "run-1",
          loginKeepalive: { stateFile: broken, watch },
        });
        account.output = VALID;
        const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
        engine.say(id, 'scriba-state {"outcome":"recorded"}');
        engine.exit(id, 0);
        await orchestrator.whenExited(id);
        expect(lines.some((line) => line.includes("НЕ ЗАМЕНЁН"))).toBe(true);
        expect(watch.status.lastOkAt).toBeNull();
      });

      it("сбой учёта итога в состоянии не ломает выход контейнера", async () => {
        orchestrator = await keepalive();
        vi.spyOn(watch, "accepted").mockRejectedValue(new Error("диск"));
        account.output = VALID;
        const id = await orchestrator.startForMeeting(MEET, "meet", 744, PASS);
        engine.say(id, 'scriba-state {"outcome":"recorded"}');
        engine.exit(id, 0);
        await expect(orchestrator.whenExited(id)).resolves.toEqual({
          kind: "finished",
          outcome: "recorded",
        });
        expect(account.calls).toContain("release:run-1");
      });

      it("слежение: при старте проба идёт сразу, а сбой проверки не роняет службу", async () => {
        orchestrator = await keepalive();
        orchestrator = build(undefined, {
          account,
          loginKeepalive: { stateFile, watch, checkIntervalMs: 5, now: () => Date.now() },
        });
        await orchestrator.startLoginKeepalive();
        await settle();
        await settle();
        expect(engine.specs[0]?.command).toEqual(["node", "/app/src/orchestrator/probe-main.ts"]);

        vi.spyOn(watch, "tick").mockRejectedValue(new Error("диск"));
        await new Promise((resolve) => {
          setTimeout(resolve, 30);
        });
        orchestrator.close();
      });

      it("слежение не настроено — старт ничего не делает", async () => {
        orchestrator = build();
        await orchestrator.startLoginKeepalive();
        expect(engine.specs).toEqual([]);
      });
    });
  });
});
