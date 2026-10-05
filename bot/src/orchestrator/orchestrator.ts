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
 * Откуда приходит команда запуска — не забота этого класса: `startForMeeting` принимает
 * описание встречи и не знает, кто его прислал. Ручной запуск по приглашению из веба (D017)
 * зовёт его из `invite-trigger.ts` и передаёт приглашение — без него сервер ручную заявку
 * бота не примет.
 */
import { randomUUID } from "node:crypto";

import {
  type ContainerLimits,
  DEFAULT_CONTAINER_LIMITS,
  DEFAULT_MAX_MEETINGS,
  loadSeccompProfile,
  validLimits,
  validMaxMeetings,
} from "../container/isolation.ts";
import { EGRESS_PROXY_ENV } from "../container/browser.ts";
import { ACCOUNT_STATE_TARGET, type AccountCopies } from "./account.ts";
import { isCalendarBasis, type MeetingBasis } from "./claim-request.ts";
import { MEETING_ENV, type SupportedPlatform, parsePlatform } from "./config.ts";
import { joinUrlFor } from "./join-url.ts";
import type { ContainerEngine, ContainerSpec, EngineContainer } from "./engine.ts";
import { LEASE_WRITE_INTERVAL_MS, writeLease } from "./lease.ts";
import { inBackground } from "./background.ts";
import type { Notifier } from "./notices.ts";
import { parseStateLine } from "./state-line.ts";
import { describeError } from "./describe-error.ts";
import type { MeetingEgress, MeetingNetwork } from "./egress.ts";

// eslint-disable-next-line sonarjs/redundant-type-aliases -- имя из контракта блока (docs/furca/blocks/orchestrator.md)
export type ContainerId = string;

/**
Куда и на какой площадке идёт контейнер встречи: ссылка уже проверена адаптером площадки.
*/
interface MeetingTarget {
  readonly joinUrl: string;
  readonly platform: SupportedPlatform;
}

export const LABEL = {
  project: "scriba.project",
  run: "scriba.run",
  onBehalfOf: "scriba.on-behalf-of",
  platform: "scriba.platform",
  invite: "scriba.invite",
  calendar: "scriba.calendar",
} as const;

// Node исполняет TypeScript снятием типов (strip-only): код бота пишется без синтаксиса, который
// требует трансформации, — это держит `erasableSyntaxOnly` в tsconfig (T148).
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
  /**
   * Уведомитель от имени человека: нотиса `container_died` уходит тому, за кого сидел
   * контейнер (`X-On-Behalf-Of`), поэтому уведомитель у каждого контейнера свой.
   */
  readonly notifierFor: (onBehalfOf: number, token: string) => Notifier;
  readonly log?: (line: string) => void;
  /**
   * Добавка к окружению контейнера: ручки смоука и времени. Обязательные переменные ею не
   * перекрываются.
   */
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly leaseIntervalMs?: number;
  readonly newRunId?: () => string;
  /**
   * Сколько встреч идёт разом. Сверх потолка `startForMeeting` отказывает до подъёма
   * контейнера, и триггер доносит отказ человеку (`start_failed`).
   */
  readonly maxMeetings?: number;
  readonly limits?: ContainerLimits;
  /**
   * Профиль seccomp строкой JSON; по умолчанию — `container/seccomp-chromium.json`.
   */
  readonly seccompProfile?: string;
  /**
   * Вход аккаунта бота (T175): своя копия на каждый контейнер. Не задан — бот идёт гостем.
   */
  readonly account?: AccountCopies;
  /**
   * Выход встречи наружу (T178): своя internal-сеть и egress-прокси. Обязателен — встреча без
   * него ходила бы куда угодно с живой сессией аккаунта бота в браузере.
   */
  readonly egress: MeetingEgress;
}

interface Managed {
  readonly id: ContainerId;
  readonly runId: string;
  readonly onBehalfOf: number;
  /**
   * Чем контейнер ходит в двери за человека: пропуск встречи (T165) или, у сервера без пропусков
   * и у подхваченных после перезапуска, общий токен.
   */
  readonly token: string;
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

/**
 * Переменные основания встречи для процесса в контейнере (`config.ts` читает их обратно).
 */
/**
 * Куда контейнер встречи ходит наружу: браузер — флагом из `SCRIBA_EGRESS_PROXY`, node-клиент
 * Swarm — штатным прокси из окружения (`NODE_USE_ENV_PROXY`, Node ≥ 24.5). Мимо прокси пути нет:
 * сеть встречи internal.
 */
function egressEnvironment(network: MeetingNetwork): Record<string, string> {
  return {
    [EGRESS_PROXY_ENV]: network.proxyUrl,
    HTTPS_PROXY: network.proxyUrl,
    HTTP_PROXY: network.proxyUrl,
    NO_PROXY: "localhost,127.0.0.1",
    NODE_USE_ENV_PROXY: "1",
  };
}

function basisEnvironment(basis: MeetingBasis | null): Record<string, string> {
  if (basis === null) return {};
  if (isCalendarBasis(basis)) {
    return {
      [MEETING_ENV.calendarKey]: basis.calendarKey,
      [MEETING_ENV.calendarStartsAt]: basis.startsAt,
      ...(basis.title !== undefined && { [MEETING_ENV.calendarTitle]: basis.title }),
    };
  }
  return { [MEETING_ENV.inviteId]: basis.id, [MEETING_ENV.inviteJoinUrl]: basis.joinUrl };
}

function basisLabel(basis: MeetingBasis | null): Record<string, string> {
  if (basis === null) return {};
  return isCalendarBasis(basis)
    ? { [LABEL.calendar]: basis.calendarKey }
    : { [LABEL.invite]: basis.id };
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

  private readonly options: OrchestratorOptions;

  /**
   * Запуски, которые уже заняли место под потолком, но ещё не попали в `running`:
   * между проверкой потолка и `track` идут `create` и `start`, и без этой брони два
   * одновременных запуска (приглашение и календарь) проскочили бы потолок оба.
   */
  private starting = 0;

  private readonly maxMeetings: number;

  private readonly limits: ContainerLimits;

  private readonly seccompProfile: string;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.maxMeetings = validMaxMeetings(options.maxMeetings ?? DEFAULT_MAX_MEETINGS);
    this.limits = validLimits(options.limits ?? DEFAULT_CONTAINER_LIMITS);
    this.seccompProfile = options.seccompProfile ?? loadSeccompProfile();
    this.log =
      options.log ??
      ((line: string): void => {
        console.log(`[orchestrator ${new Date().toISOString()}] ${line}`);
      });
  }

  /**
   * Том записей — свой у каждого человека: контейнер встречи видит только очередь выгрузки
   * того, за кого сидит. Не на запуск, а на человека: недовыгруженную запись умершего
   * контейнера подбирает следующий запуск того же человека (`run-directories.ts`).
   */
  private volumeFor(onBehalfOf: number): string {
    return `${this.options.project}-recordings-${String(onBehalfOf)}`;
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
      this.log(`не удалось убрать ${id}: ${describeError(error)}`);
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

  private async releaseEgress(runId: string): Promise<void> {
    try {
      await this.options.egress.release(runId);
    } catch (error) {
      this.log(`сеть встречи запуска ${runId} не убрана: ${describeError(error)}`);
    }
  }

  private async releaseAccount(runId: string): Promise<void> {
    try {
      await this.options.account?.release(runId);
    } catch (error) {
      this.log(`копия входа запуска ${runId} не убрана: ${describeError(error)}`);
    }
  }

  private environment(
    target: MeetingTarget,
    onBehalfOf: number,
    runId: string,
    basis: MeetingBasis | null,
    account: string | null,
    network: MeetingNetwork,
  ): string[] {
    const own: Record<string, string> = {
      [MEETING_ENV.joinUrl]: target.joinUrl,
      [MEETING_ENV.platform]: target.platform,
      [MEETING_ENV.onBehalfOf]: String(onBehalfOf),
      [MEETING_ENV.swarmUrl]: this.options.swarmUrl,
      // Пропуск встречи вместо общего токена агента (T165): контейнер действует только в
      // границах своей встречи. Общий токен — лишь если сервер пропуска не выдал.
      [MEETING_ENV.token]: basis?.grantToken ?? this.options.token,
      [MEETING_ENV.runId]: runId,
      [MEETING_ENV.version]: String(this.options.version),
      [MEETING_ENV.leaseDir]: LEASE_PATH,
      ...basisEnvironment(basis),
      ...(account !== null && { [MEETING_ENV.accountState]: ACCOUNT_STATE_TARGET }),
      ...egressEnvironment(network),
    };
    const merged = { ...this.options.extraEnv, ...own };
    return Object.entries(merged).map(([name, value]) => `${name}=${value}`);
  }

  private spec(
    target: MeetingTarget,
    onBehalfOf: number,
    runId: string,
    basis: MeetingBasis | null,
    account: string | null,
    network: MeetingNetwork,
  ): ContainerSpec {
    return {
      name: `${this.options.project}-meeting-${runId}`,
      image: this.options.image,
      command: CONTAINER_COMMAND,
      env: this.environment(target, onBehalfOf, runId, basis, account, network),
      labels: {
        [LABEL.project]: this.options.project,
        [LABEL.run]: runId,
        [LABEL.onBehalfOf]: String(onBehalfOf),
        [LABEL.platform]: target.platform,
        ...basisLabel(basis),
      },
      volume: { name: this.volumeFor(onBehalfOf), target: RECORDINGS_PATH },
      readOnlyBind: { source: this.options.leaseDirectory, target: LEASE_PATH },
      ...(account !== null && { accountState: { source: account, target: ACCOUNT_STATE_TARGET } }),
      shmBytes: SHM_BYTES,
      limits: this.limits,
      seccompProfile: this.seccompProfile,
      network: network.network,
    };
  }

  private track(
    id: ContainerId,
    runId: string,
    onBehalfOf: number,
    exitCode: Promise<number | null>,
    token: string = this.options.token,
  ): void {
    const managed: Managed = {
      id,
      runId,
      onBehalfOf,
      token,
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
        this.log(`журнал ${id} не читается: ${describeError(error)}`);
      },
    );
  }

  private async watchExit(managed: Managed, exitCode: Promise<number | null>): Promise<void> {
    let code: number | null;
    try {
      code = await exitCode;
    } catch (error) {
      this.log(`ожидание выхода ${managed.id} сорвалось: ${describeError(error)}`);
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
    // Исход — сразу вслед за удалением из `running`: `whenExited`, пришедший в промежутке,
    // иначе не нашёл бы ни живого контейнера, ни его исхода.
    this.exits.set(
      managed.id,
      code === 0
        ? { kind: "finished", outcome: managed.outcome }
        : { kind: "died", exitCode: code, meetingId: managed.meetingId },
    );
    await this.releaseAccount(managed.runId);
    await this.releaseEgress(managed.runId);
    if (code === 0) {
      this.log(`контейнер ${managed.id} закончил встречу: ${managed.outcome ?? "исход не назван"}`);
      return;
    }

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
      await this.options.notifierFor(managed.onBehalfOf, managed.token).notify({
        kind: "container_died",
        meetingId: managed.meetingId,
        detail: `exit ${String(code)}`,
      });
    } catch (error) {
      this.log(`нотиса container_died не ушла: ${describeError(error)}`);
    }
  }

  private reserveSlot(): void {
    const busy = this.running.size + this.starting;
    if (busy >= this.maxMeetings) {
      // Текст уходит человеку внутрь «scriba could not start for this call: …».
      throw new Error(
        `all ${String(busy)} of ${String(this.maxMeetings)} meeting slots are busy right now`,
      );
    }
    this.starting += 1;
  }

  private async launch(
    spec: ContainerSpec,
    runId: string,
    person: number,
    token: string,
  ): Promise<ContainerId> {
    const { engine } = this.options;
    const id = await engine.create(spec);
    // Ожидание выхода регистрируется ДО старта: контейнер убирается сам сразу после выхода,
    // и опоздавшее ожидание не застало бы ни его, ни кода выхода.
    const exited = engine.waitExit(id, "next-exit");
    try {
      await engine.start(id);
    } catch (error) {
      await this.removeQuietly(id);
      throw new Error(`контейнер встречи не стартовал: ${describeError(error)}`, { cause: error });
    }
    this.log(`контейнер ${id} поднят на встречу (запуск ${runId}, от имени ${String(person)})`);
    this.track(id, runId, person, exited, token);
    return id;
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
          this.log(`поводок не записан: ${describeError(error)} — контейнеры сочтут себя сиротами`);
        },
      );
    }, this.options.leaseIntervalMs ?? LEASE_WRITE_INTERVAL_MS);
    await this.reconcile();
    const liveRuns = new Set(Array.from(this.running.values(), (managed) => managed.runId));
    await this.options.account?.sweep(liveRuns);
    try {
      await this.options.egress.sweep(liveRuns);
    } catch (error) {
      this.log(`разбор сетей встреч сорвался: ${describeError(error)}`);
    }
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
   *
   * `basis` — на каком основании бот идёт: приглашение из веба (D017) — бот предъявит его в
   * `meeting-claim`, ручную встречу без него сервер служебному агенту не заводит; событие
   * календаря (T100) — бот заявит календарную встречу его ключом.
   */
  async startForMeeting(
    joinUrl: string,
    platform: string,
    onBehalfOf: number,
    basis: MeetingBasis | null = null,
  ): Promise<ContainerId> {
    const known = parsePlatform(platform);
    const target: MeetingTarget = { joinUrl: joinUrlFor(known, joinUrl), platform: known };
    const person = validOnBehalfOf(onBehalfOf);
    const runId = (this.options.newRunId ?? randomUUID)();

    this.reserveSlot();
    try {
      // Вход аккаунта Google нужен только Meet: в Толк бот идёт гостем (D040), и живая сессия
      // Google в контейнере чужой площадки была бы лишь тем, что можно унести.
      const account =
        known === "meet" ? ((await this.options.account?.prepare(runId)) ?? null) : null;
      try {
        const network = await this.options.egress.prepare(runId);
        try {
          return await this.launch(
            this.spec(target, person, runId, basis, account, network),
            runId,
            person,
            basis?.grantToken ?? this.options.token,
          );
        } catch (error) {
          await this.releaseEgress(runId);
          throw error;
        }
      } catch (error) {
        await this.releaseAccount(runId);
        throw error;
      }
    } finally {
      this.starting -= 1;
    }
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
