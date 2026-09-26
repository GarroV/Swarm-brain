/**
 * Оркестратор: жизненный цикл контейнеров встреч. Долгоживущий, живёт рядом с Docker.
 *
 * Три обязанности, и все три — про то, чтобы ничего не случилось молча:
 *  1. поднять контейнер на встречу и погасить его по просьбе (`startForMeeting` / `stop`);
 *  2. увидеть смерть контейнера: ненулевой код выхода — это смерть, о ней уходит нотиса
 *     `container_died`, привязанная к `meeting_id` из журнала контейнера;
 *  3. не оставлять сирот: оркестратор держит поводок (контейнер без поводка заканчивает
 *     встречу сам), а на старте подхватывает живые контейнеры своего проекта и убирает
 *     остановленные.
 *
 * Heartbeat на сервер шлёт процесс встречи изнутри контейнера: сигнал «жив» идёт от того,
 * чья жизнь меряется, поэтому смерть контейнера обрывает его без участия оркестратора.
 *
 * Откуда приходит команда запуска — не забота этого класса (вопрос владельцу Q008):
 * `startForMeeting` принимает описание встречи и не знает, кто его прислал.
 */
import { randomUUID } from "node:crypto";

import { pinMeetLocale } from "../meet-adapter/url.ts";
import { MEETING_ENV, parsePlatform } from "./config.ts";
import type { ContainerEngine, ContainerSpec, EngineContainer } from "./engine.ts";
import { LEASE_WRITE_INTERVAL_MS, writeLease } from "./lease.ts";
import { inBackground } from "./background.ts";
import type { Notifier } from "./notices.ts";
import { parseStateLine } from "./state-line.ts";

// eslint-disable-next-line sonarjs/redundant-type-aliases -- имя из контракта блока (docs/furca/blocks/orchestrator.md)
export type ContainerId = string;

export const LABEL = {
  project: "scriba.project",
  run: "scriba.run",
  onBehalfOf: "scriba.on-behalf-of",
  platform: "scriba.platform",
} as const;

const CONTAINER_COMMAND = ["node", "/app/src/orchestrator/container-main.ts"];
const RECORDINGS_PATH = "/recordings";
const LEASE_PATH = "/lease";
const SHM_BYTES = 1024 * 1024 * 1024;
/**
 * Сколько ждать штатного конца после SIGTERM: выйти из звонка, дописать ffmpeg, выгрузить.
 */
export const STOP_GRACE_SECONDS = 120;
const LOG_TAIL_LINES = 40;

export interface OrchestratorOptions {
  readonly engine: ContainerEngine;
  /**
   * Имя стенда: им помечены контейнеры, том и всё, что оркестратор считает своим.
   * Чужое (другое имя) он не трогает никогда.
   */
  readonly project: string;
  readonly image: string;
  /**
   * Каталог поводка на хосте; монтируется в контейнеры только на чтение.
   */
  readonly leaseDirectory: string;
  readonly swarmUrl: string;
  readonly token: string;
  readonly version: number;
  readonly notifier: Notifier;
  readonly log?: (line: string) => void;
  /**
   * Добавка к окружению контейнера: ручки смоука и времени. Обязательные переменные ею не
   * перекрываются.
   */
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly leaseIntervalMs?: number;
  readonly newRunId?: () => string;
}

interface Managed {
  readonly id: ContainerId;
  readonly runId: string;
  readonly onBehalfOf: number;
  meetingId: string | null;
  outcome: string | null;
  readonly tail: string[];
  exited: Promise<void>;
}

export interface ManagedMeeting {
  readonly id: ContainerId;
  readonly runId: string;
  readonly onBehalfOf: number;
  readonly meetingId: string | null;
}

export type ContainerExit =
  | { readonly kind: "finished"; readonly outcome: string | null }
  | { readonly kind: "died"; readonly exitCode: number | null; readonly meetingId: string | null };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validOnBehalfOf(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`onBehalfOf должен быть telegram id человека, получено ${String(value)}`);
  }
  return value;
}

export class Orchestrator {
  private readonly running = new Map<ContainerId, Managed>();

  private readonly exits = new Map<ContainerId, ContainerExit>();

  private leaseTimer: NodeJS.Timeout | undefined;

  private leaseSeq = 0;

  private readonly log: (line: string) => void;

  constructor(private readonly options: OrchestratorOptions) {
    this.log =
      options.log ??
      ((line: string): void => {
        console.log(`[orchestrator ${new Date().toISOString()}] ${line}`);
      });
  }

  private get volume(): string {
    return `${this.options.project}-recordings`;
  }

  private async beatLease(): Promise<void> {
    this.leaseSeq += 1;
    await writeLease(this.options.leaseDirectory, this.leaseSeq);
  }

  private async reconcile(): Promise<void> {
    const found = await this.options.engine.listByLabel(LABEL.project, this.options.project);
    for (const container of found) {
      if (container.running) {
        this.adopt(container);
      } else {
        this.log(`убираю остановленный контейнер прошлого запуска ${container.id}`);
        await this.removeQuietly(container.id);
      }
    }
  }

  private async removeQuietly(id: ContainerId): Promise<void> {
    try {
      await this.options.engine.remove(id);
    } catch (error) {
      this.log(`не удалось убрать ${id}: ${describe(error)}`);
    }
  }

  private adopt(container: EngineContainer): void {
    const runId = container.labels[LABEL.run] ?? "unknown";
    const onBehalfOf = Number(container.labels[LABEL.onBehalfOf]);
    this.log(`подхватываю живой контейнер ${container.id} (запуск ${runId})`);
    this.track(
      container.id,
      runId,
      onBehalfOf,
      this.options.engine.waitExit(container.id, "not-running"),
    );
  }

  private environment(joinUrl: string, onBehalfOf: number, runId: string): string[] {
    const own: Record<string, string> = {
      [MEETING_ENV.joinUrl]: joinUrl,
      [MEETING_ENV.platform]: "meet",
      [MEETING_ENV.onBehalfOf]: String(onBehalfOf),
      [MEETING_ENV.swarmUrl]: this.options.swarmUrl,
      [MEETING_ENV.token]: this.options.token,
      [MEETING_ENV.runId]: runId,
      [MEETING_ENV.version]: String(this.options.version),
      [MEETING_ENV.leaseDir]: LEASE_PATH,
    };
    const merged = { ...this.options.extraEnv, ...own };
    return Object.entries(merged).map(([name, value]) => `${name}=${value}`);
  }

  private spec(joinUrl: string, onBehalfOf: number, runId: string): ContainerSpec {
    return {
      name: `${this.options.project}-meeting-${runId}`,
      image: this.options.image,
      command: CONTAINER_COMMAND,
      env: this.environment(joinUrl, onBehalfOf, runId),
      labels: {
        [LABEL.project]: this.options.project,
        [LABEL.run]: runId,
        [LABEL.onBehalfOf]: String(onBehalfOf),
        [LABEL.platform]: "meet",
      },
      volume: { name: this.volume, target: RECORDINGS_PATH },
      readOnlyBind: { source: this.options.leaseDirectory, target: LEASE_PATH },
      shmBytes: SHM_BYTES,
    };
  }

  private track(
    id: ContainerId,
    runId: string,
    onBehalfOf: number,
    exitCode: Promise<number | null>,
  ): void {
    const managed: Managed = {
      id,
      runId,
      onBehalfOf,
      meetingId: null,
      outcome: null,
      tail: [],
      exited: Promise.resolve(),
    };
    managed.exited = this.watchExit(managed, exitCode);
    this.running.set(id, managed);
    inBackground(
      async () =>
        this.options.engine.followLogs(id, (line) => {
          this.onLogLine(managed, line);
        }),
      (error) => {
        this.log(`журнал ${id} не читается: ${describe(error)}`);
      },
    );
  }

  private async watchExit(managed: Managed, exitCode: Promise<number | null>): Promise<void> {
    let code: number | null;
    try {
      code = await exitCode;
    } catch (error) {
      this.log(`ожидание выхода ${managed.id} сорвалось: ${describe(error)}`);
      code = null;
    }
    await this.onExit(managed, code);
  }

  private onLogLine(managed: Managed, line: string): void {
    managed.tail.push(line);
    if (managed.tail.length > LOG_TAIL_LINES) managed.tail.shift();
    const state = parseStateLine(line);
    if (state?.meetingId !== undefined) managed.meetingId = state.meetingId;
    if (state?.outcome !== undefined) managed.outcome = state.outcome;
  }

  private async onExit(managed: Managed, code: number | null): Promise<void> {
    this.running.delete(managed.id);
    if (code === 0) {
      this.exits.set(managed.id, { kind: "finished", outcome: managed.outcome });
      this.log(`контейнер ${managed.id} закончил встречу: ${managed.outcome ?? "исход не назван"}`);
      return;
    }

    this.exits.set(managed.id, { kind: "died", exitCode: code, meetingId: managed.meetingId });
    this.log(
      `КОНТЕЙНЕР УМЕР ${managed.id} (запуск ${managed.runId}, код ${String(code)}, ` +
        `встреча ${managed.meetingId ?? "не заявлена"}). Хвост журнала:\n  ${managed.tail.join("\n  ")}`,
    );
    if (managed.meetingId === null) {
      // Встреча не заявлена — привязать нотису не к чему. Громко остаётся только журнал.
      this.log("нотиса container_died не отправлена: meeting_id нет, контейнер умер до claim");
      return;
    }
    try {
      await this.options.notifier.notify({
        kind: "container_died",
        meetingId: managed.meetingId,
        detail: `exit ${String(code)}`,
      });
    } catch (error) {
      this.log(`нотиса container_died не ушла: ${describe(error)}`);
    }
  }

  /**
   * Запуск службы: поводок, затем разбор того, что осталось от прошлого запуска.
   * Поводок — первым: подхваченные контейнеры не должны успеть счесть себя сиротами.
   */
  async init(): Promise<void> {
    await this.beatLease();
    this.leaseTimer = setInterval(() => {
      inBackground(
        async () => this.beatLease(),
        (error) => {
          this.log(`поводок не записан: ${describe(error)} — контейнеры сочтут себя сиротами`);
        },
      );
    }, this.options.leaseIntervalMs ?? LEASE_WRITE_INTERVAL_MS);
    await this.reconcile();
  }

  /**
   * Остановить службу. Контейнеры НЕ гасятся: перезапуск оркестратора не должен рвать
   * идущие встречи. Не вернётся за порог поводка — они закончат встречу сами.
   */
  close(): void {
    clearInterval(this.leaseTimer);
    this.leaseTimer = undefined;
  }

  /**
   * Поднять контейнер на встречу. Площадка без адаптера и кривая ссылка отвергаются ДО
   * подъёма: бот, ушедший не туда, хуже бота, который не пошёл.
   */
  async startForMeeting(
    joinUrl: string,
    platform: string,
    onBehalfOf: number,
  ): Promise<ContainerId> {
    parsePlatform(platform);
    const pinned = pinMeetLocale(joinUrl);
    const person = validOnBehalfOf(onBehalfOf);
    const runId = (this.options.newRunId ?? randomUUID)();

    const { engine } = this.options;
    const id = await engine.create(this.spec(pinned, person, runId));
    // Ожидание выхода регистрируется ДО старта: контейнер убирается сам сразу после выхода,
    // и опоздавшее ожидание не застало бы ни его, ни кода выхода.
    const exited = engine.waitExit(id, "next-exit");
    try {
      await engine.start(id);
    } catch (error) {
      await this.removeQuietly(id);
      throw new Error(`контейнер встречи не стартовал: ${describe(error)}`, { cause: error });
    }
    this.log(`контейнер ${id} поднят на встречу (запуск ${runId}, от имени ${String(person)})`);
    this.track(id, runId, person, exited);
    return id;
  }

  /**
   * Погасить контейнер встречи штатно: SIGTERM, процесс встречи выходит из звонка и
   * выгружает записанное; не уложился в срок — Docker добивает его сам.
   */
  async stop(id: ContainerId): Promise<void> {
    const managed = this.running.get(id);
    if (managed === undefined) throw new Error(`контейнер ${id} не наш или уже закончился`);
    await this.options.engine.stop(id, STOP_GRACE_SECONDS);
    await managed.exited;
  }

  list(): ManagedMeeting[] {
    return Array.from(this.running.values(), ({ id, runId, onBehalfOf, meetingId }) => ({
      id,
      runId,
      onBehalfOf,
      meetingId,
    }));
  }

  /**
   * Чем кончился контейнер; `undefined` — ещё идёт или не наш.
   */
  exitOf(id: ContainerId): ContainerExit | undefined {
    return this.exits.get(id);
  }

  /**
   * Дождаться выхода контейнера (для смоука и тестов).
   */
  async whenExited(id: ContainerId): Promise<ContainerExit | undefined> {
    await this.running.get(id)?.exited;
    return this.exits.get(id);
  }
}
