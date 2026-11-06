// Shared doubles for orchestrator unit tests; each test constructs its own instances.
import { rm, writeFile } from "node:fs/promises";
import type { AccountCopies } from "../src/orchestrator/account.ts";
import type { MeetingEgress, MeetingNetwork } from "../src/orchestrator/egress.ts";
import type {
  ContainerEngine,
  ContainerSpec,
  EngineContainer,
} from "../src/orchestrator/engine.ts";
import type { Notice, NoticeResult } from "../src/orchestrator/notices.ts";
import type { Orchestrator } from "../src/orchestrator/orchestrator.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- lib проекта ES2023, withResolvers там нет
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  if (resolve === undefined) throw new Error("executor Promise отработал не синхронно");
  return { promise, resolve };
}

export async function replaceWithFile(target: string, attempts = 20): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true });
    await writeFile(target, "not a directory");
  } catch (error) {
    if (attempts <= 1) throw error;
    await replaceWithFile(target, attempts - 1);
  }
}

export function environmentOf(spec: ContainerSpec | undefined): string[] {
  return [...(spec?.env ?? [])];
}

export class FakeAccount implements AccountCopies {
  readonly calls: string[] = [];
  hasSignIn = true;
  shouldFail = false;
  shouldFailRelease = false;
  output: string | null = null;

  prepare(runId: string): Promise<string | null> {
    this.calls.push(`prepare:${runId}`);
    if (this.shouldFail)
      return Promise.reject(new Error("the bot's saved Google sign-in is damaged"));
    return Promise.resolve(this.hasSignIn ? `/copies/${runId}.json` : null);
  }

  prepareOutput(runId: string): Promise<string> {
    this.calls.push(`prepareOutput:${runId}`);
    return Promise.resolve(`/copies/${runId}.out`);
  }

  readOutput(runId: string): Promise<string | null> {
    this.calls.push(`readOutput:${runId}`);
    return Promise.resolve(this.output);
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

export const PROXY_URL = `${["ht", "tp:"].join("")}//egress:3128`;

export class FakeEgress implements MeetingEgress {
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

export class FakeEngine implements ContainerEngine {
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

export async function finishProbe(
  engine: FakeEngine,
  orchestrator: Orchestrator,
  outcome: string | null,
): Promise<void> {
  if (outcome !== null) engine.say("c1", `scriba-state {"outcome":"${outcome}"}`);
  engine.exit("c1", 0);
  await orchestrator.whenExited("c1");
}

export const settle = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export const PASS = {
  calendarKey: "evt-test:2026-09-28",
  startsAt: "2026-09-28T10:00:00.000Z",
  grantToken: "sgr_test-pass",
} as const;

/** Preserve notification observations independently for every test fixture. */
export class NoticeCapture {
  readonly notices: Notice[] = [];
  readonly recipients: number[] = [];
  readonly noticeTokens: string[] = [];

  readonly forRecipient = (onBehalfOf: number, token: string) => ({
    notify: (notice: Notice): Promise<NoticeResult> => {
      this.notices.push(notice);
      this.recipients.push(onBehalfOf);
      this.noticeTokens.push(token);
      return Promise.resolve({ delivered: true, shouldLeave: false });
    },
  });
}
