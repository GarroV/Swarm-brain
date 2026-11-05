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
import {
  ACCOUNT_OUTPUT_NAME,
  ACCOUNT_OUTPUT_TARGET,
  ACCOUNT_STATE_TARGET,
  type AccountCopies,
} from "./account.ts";
import { commitExport } from "./account-writeback.ts";
import { type LoginWatch, isProbeDue } from "./login-watch.ts";
import { SerialQueue } from "./serial-queue.ts";
import { isCalendarBasis, type MeetingBasis } from "./claim-request.ts";
import { MEETING_ENV, type SupportedPlatform, parsePlatform } from "./config.ts";
import { joinUrlFor } from "./join-url.ts";
import type { ContainerEngine, ContainerSpec, EngineContainer } from "./engine.ts";
import { LEASE_WRITE_INTERVAL_MS, writeLease } from "./lease.ts";
import { inBackground } from "./background.ts";
import type { Notifier } from "./notices.ts";
import { parseStateLine } from "./state-line.ts";
import { type SilenceAlertInput, silenceAlertText } from "./owner-alert.ts";
import { describeError } from "./describe-error.ts";
import type { MeetingEgress, MeetingNetwork } from "./egress.ts";
import type { RunLogs, RunLogWriter } from "./run-log.ts";

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
const PROBE_COMMAND = ["node", "/app/src/orchestrator/probe-main.ts"];
const PROBE_PLATFORM = "meet";
const PROBE_PERSON = 0;
/**
Выгрузка контейнера в его каталоге запуска, как её видит контейнер.
*/
const ACCOUNT_OUTPUT_FILE = `${ACCOUNT_OUTPUT_TARGET}/${ACCOUNT_OUTPUT_NAME}`;
const PROBE_CHECK_MS = 10 * 60 * 1000;
const DEFAULT_PROBE_HOUR = 6;
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
   * Журнал каждого запуска на диске службы (#832): контейнер встречи удаляется по выходе вместе
   * со своим журналом. Не задан — журнал только в памяти (хвост для «контейнер умер»).
   */
  readonly runLogs?: RunLogs;
  /**
   * Выход встречи наружу (T178): своя internal-сеть и egress-прокси. Обязателен — встреча без
   * него ходила бы куда угодно с живой сессией аккаунта бота в браузере.
   */
  readonly egress: MeetingEgress;
  /**
   * Срочное предупреждение владельцу (канал FURCA, #861): тишина в записи при людях в звонке.
   * Не задан — тревога остаётся строкой журнала.
   */
  readonly alertOwner?: (text: string) => Promise<void>;
  /**
   * Продление входа аккаунта бота (#1140): выгрузка контейнера возвращается на место файла входа,
   * раз в сутки идёт пробный заход, слетевший вход — состояние с тревогой владельцу. Нужен вместе
   * с `account`; без него вход не продлевается, как до #1140.
   */
  readonly loginKeepalive?: {
    /**
    Файл входа, который заменяется выгрузкой (его каталог должен быть записываемым).
    */
    readonly stateFile: string;
    readonly watch: LoginWatch;
    /**
    Час суток по Белграду для ежедневной пробы; по умолчанию 6.
    */
    readonly probeHour?: number;
    readonly checkIntervalMs?: number;
    readonly now?: () => number;
  };
}

/**
 * Что запуск делает со входом аккаунта бота (#1140): `probe` — пробный заход без встречи,
 * `usesAccount` — шёл под входом и выгружает обновлённый.
 */
interface LoginUse {
  readonly kind: "meeting" | "probe";
  readonly usesAccount: boolean;
}

const MEETING_WITHOUT_LOGIN: LoginUse = { kind: "meeting", usesAccount: false };

interface Managed {
  readonly id: ContainerId;
  readonly runId: string;
  readonly onBehalfOf: number;
  /**
   * Чем контейнер ходит в двери за человека: пропуск встречи (T165) или, у сервера без пропусков
   * и у подхваченных после перезапуска, общий токен.
   */
  readonly token: string;
  /**
  `probe` — пробный заход в Meet без встречи (#1140).
  */
  readonly kind: "meeting" | "probe";
  /**
  Запуск шёл под входом аккаунта бота и выгружает обновлённый.
  */
  readonly usesAccount: boolean;
  meetingId: string | null;
  outcome: string | null;
  readonly tail: string[];
  readonly journal: RunLogWriter | null;
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

  private keepaliveTimer: NodeJS.Timeout | undefined;

  private probing = false;

  // Замены файла входа идут по одной: временный файл у них общий по имени.
  private readonly writeQueue = new SerialQueue();

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
    basis: MeetingBasis,
    grantToken: string,
    account: string | null,
    network: MeetingNetwork,
    hasOutput: boolean,
  ): string[] {
    const own: Record<string, string> = {
      [MEETING_ENV.joinUrl]: target.joinUrl,
      [MEETING_ENV.platform]: target.platform,
      [MEETING_ENV.onBehalfOf]: String(onBehalfOf),
      [MEETING_ENV.swarmUrl]: this.options.swarmUrl,
      // Пропуск встречи вместо общего токена агента (T165): контейнер действует только в
      // границах своей встречи. Без пропуска контейнер не поднимается (startForMeeting).
      [MEETING_ENV.token]: grantToken,
      [MEETING_ENV.runId]: runId,
      [MEETING_ENV.version]: String(this.options.version),
      [MEETING_ENV.leaseDir]: LEASE_PATH,
      ...basisEnvironment(basis),
      ...(account !== null && { [MEETING_ENV.accountState]: ACCOUNT_STATE_TARGET }),
      ...(hasOutput && { [MEETING_ENV.accountOutput]: ACCOUNT_OUTPUT_FILE }),
      ...egressEnvironment(network),
    };
    const merged = { ...this.options.extraEnv, ...own };
    return Object.entries(merged).map(([name, value]) => `${name}=${value}`);
  }

  private spec(
    target: MeetingTarget,
    onBehalfOf: number,
    runId: string,
    basis: MeetingBasis,
    grantToken: string,
    account: string | null,
    network: MeetingNetwork,
    output: string | null,
  ): ContainerSpec {
    return {
      name: `${this.options.project}-meeting-${runId}`,
      image: this.options.image,
      command: CONTAINER_COMMAND,
      env: this.environment(
        target,
        onBehalfOf,
        runId,
        basis,
        grantToken,
        account,
        network,
        output !== null,
      ),
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
      ...(output !== null && { accountOutput: { source: output, target: ACCOUNT_OUTPUT_TARGET } }),
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
    login: LoginUse = MEETING_WITHOUT_LOGIN,
  ): void {
    const managed: Managed = {
      id,
      runId,
      onBehalfOf,
      token,
      kind: login.kind,
      usesAccount: login.usesAccount,
      meetingId: null,
      outcome: null,
      tail: [],
      journal: this.options.runLogs?.open(runId) ?? null,
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
    managed.journal?.line(line);
    managed.tail.push(line);
    if (managed.tail.length > LOG_TAIL_LINES) managed.tail.shift();
    const state = parseStateLine(line);
    if (state?.meetingId !== undefined) managed.meetingId = state.meetingId;
    if (state?.outcome !== undefined) managed.outcome = state.outcome;
    if (state?.audio !== undefined) {
      this.alertSilence(managed, {
        audio: state.audio,
        title: state.title,
        platform: state.platform,
        runId: managed.runId,
      });
    }
  }

  private alertSilence(managed: Managed, input: SilenceAlertInput): void {
    const text = silenceAlertText(input);
    const send = this.options.alertOwner;
    if (send === undefined) {
      this.log(`предупреждение владельцу не настроено (канал FURCA): ${text}`);
      return;
    }
    inBackground(
      async () => {
        await send(text);
        managed.journal?.line(`# предупреждение владельцу ушло: ${text}`);
      },
      (error) => {
        this.log(`предупреждение владельцу НЕ ушло (${describeError(error)}): ${text}`);
      },
    );
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
    managed.journal?.line(
      `# выход: код ${String(code)}, исход ${managed.outcome ?? "не назван"}, ` +
        `встреча ${managed.meetingId ?? "не заявлена"}`,
    );
    this.options.runLogs?.prune();
    await this.afterLoginRun(managed, code);
    await this.releaseAccount(managed.runId);
    await this.releaseEgress(managed.runId);
    if (code === 0) {
      this.log(
        `контейнер ${managed.id} закончил встречу: ${managed.outcome ?? "исход не назван"} ` +
          `(запуск ${managed.runId}, встреча ${managed.meetingId ?? "не заявлена"})`,
      );
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

  /**
   * Каталог выгрузки обновлённого входа для запуска; `null` — продление не включено или запуск
   * идёт без входа.
   */
  private async prepareOutput(runId: string, account: string | null): Promise<string | null> {
    if (account === null || this.options.loginKeepalive === undefined) return null;
    return (await this.options.account?.prepareOutput(runId)) ?? null;
  }

  /**
   * Причина слетевшего входа из хвоста журнала контейнера («дверь: signin_required — …»): её
   * вынес адаптер, оркестратору хватает пересказать.
   */
  private signinReason(managed: Managed): string {
    const pattern = /signin_required — (.+)$/u;
    for (const line of managed.tail.toReversed()) {
      const reason = pattern.exec(line)?.[1];
      if (reason !== undefined) return reason.trim();
    }
    return "Google просит вход";
  }

  private async replaceState(managed: Managed): Promise<boolean> {
    const keepalive = this.options.loginKeepalive;
    if (keepalive === undefined) return false;
    const isStateReplaced = async (): Promise<boolean> => {
      const raw = await this.options.account?.readOutput(managed.runId);
      const result = await commitExport({
        stateFile: keepalive.stateFile,
        raw: raw ?? null,
        outcome: managed.outcome,
      });
      if (result.written) {
        this.log(
          `вход аккаунта бота продлён выгрузкой запуска ${managed.runId} (${String(result.cookies)} кук)`,
        );
      } else {
        const alarm = result.reason.includes("подмена") ? "ВЫГРУЗКА ОТКЛОНЕНА: " : "";
        this.log(
          `${alarm}вход аккаунта бота не заменён (запуск ${managed.runId}): ${result.reason}`,
        );
      }
      return result.written;
    };
    try {
      return await this.writeQueue.run(isStateReplaced);
    } catch (error) {
      this.log(`ВХОД АККАУНТА БОТА НЕ ЗАМЕНЁН — сбой записи: ${describeError(error)}`);
      return false;
    }
  }

  /**
   * Итог запуска для входа аккаунта бота: продлить файл входа и сообщить состоянию (`LoginWatch`).
   * Идёт до уборки каталога выгрузки. Сбой здесь не мешает остальному разбору выхода.
   */
  private async afterLoginRun(managed: Managed, code: number | null): Promise<void> {
    const keepalive = this.options.loginKeepalive;
    if (managed.kind === "probe") this.probing = false;
    if (keepalive === undefined || !managed.usesAccount) return;
    const { watch } = keepalive;
    try {
      if (managed.outcome === "account_signin_required") {
        await watch.signinRequired(this.signinReason(managed));
        if (managed.kind === "probe") await watch.probeFinished();
        return;
      }
      const isWritten = await this.replaceState(managed);
      if (isWritten) {
        await watch.accepted();
        if (managed.kind === "probe") await watch.probeFinished();
      } else if (managed.kind === "probe") {
        await watch.probeCrashed(
          `проба не принесла годного входа (код ${String(code)}, исход ${managed.outcome ?? "не назван"})`,
        );
      }
    } catch (error) {
      this.log(
        `итог запуска ${managed.runId} для входа аккаунта не учтён: ${describeError(error)}`,
      );
    }
  }

  private async checkLogin(): Promise<void> {
    const keepalive = this.options.loginKeepalive;
    if (keepalive === undefined) return;
    await keepalive.watch.tick();
    const now = (keepalive.now ?? Date.now)();
    if (isProbeDue(keepalive.watch.status, now, keepalive.probeHour ?? DEFAULT_PROBE_HOUR)) {
      await this.runProbe();
    }
  }

  private probeSpec(
    runId: string,
    account: string,
    output: string,
    network: MeetingNetwork,
  ): ContainerSpec {
    const environment: Record<string, string> = {
      [MEETING_ENV.accountState]: ACCOUNT_STATE_TARGET,
      [MEETING_ENV.accountOutput]: ACCOUNT_OUTPUT_FILE,
      ...egressEnvironment(network),
    };
    return {
      name: `${this.options.project}-probe-${runId}`,
      image: this.options.image,
      command: PROBE_COMMAND,
      env: Object.entries(environment).map(([name, value]) => `${name}=${value}`),
      labels: {
        [LABEL.project]: this.options.project,
        [LABEL.run]: runId,
        [LABEL.onBehalfOf]: String(PROBE_PERSON),
        [LABEL.platform]: PROBE_PLATFORM,
      },
      volume: { name: this.volumeFor(PROBE_PERSON), target: RECORDINGS_PATH },
      readOnlyBind: { source: this.options.leaseDirectory, target: LEASE_PATH },
      accountState: { source: account, target: ACCOUNT_STATE_TARGET },
      accountOutput: { source: output, target: ACCOUNT_OUTPUT_TARGET },
      shmBytes: SHM_BYTES,
      limits: this.limits,
      seccompProfile: this.seccompProfile,
      network: network.network,
    };
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
    login: LoginUse,
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
    this.track(id, runId, person, exited, token, login);
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
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
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
    // Без пропуска встречи от сервера контейнер не поднимается: раньше вместо него в контейнер
    // уходил общий токен агента — с правами шире одной встречи.
    const grantToken = basis?.grantToken;
    if (basis === null || grantToken === undefined || grantToken === "") {
      const reason =
        "сервер не выдал пропуск встречи — контейнер не запускаю (общий токен в контейнер не передаётся)";
      this.log(`встреча за ${String(person)} не начата: ${reason}`);
      throw new Error(reason);
    }
    const runId = (this.options.newRunId ?? randomUUID)();

    this.reserveSlot();
    try {
      // Вход аккаунта Google нужен только Meet: в Толк бот идёт гостем (D040), и живая сессия
      // Google в контейнере чужой площадки была бы лишь тем, что можно унести.
      const account =
        known === "meet" ? ((await this.options.account?.prepare(runId)) ?? null) : null;
      try {
        const output = await this.prepareOutput(runId, account);
        const network = await this.options.egress.prepare(runId);
        try {
          return await this.launch(
            this.spec(target, person, runId, basis, grantToken, account, network, output),
            runId,
            person,
            grantToken,
            { kind: "meeting", usesAccount: account !== null },
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
   * Пробный заход в Meet под входом бота: контейнер того же образа без встречи. Слот не крадёт:
   * все места заняты — пробы нет, ближайшая проверка попробует снова. Возвращает, поднят ли
   * контейнер.
   */
  async runProbe(): Promise<boolean> {
    const keepalive = this.options.loginKeepalive;
    const accounts = this.options.account;
    if (keepalive === undefined || accounts === undefined || this.probing) return false;
    if (this.running.size + this.starting >= this.maxMeetings) {
      this.log("пробный заход во вход Google отложен: все места заняты встречами");
      return false;
    }
    this.probing = true;
    const runId = `probe-${randomUUID()}`;
    this.starting += 1;
    let hasLaunched = false;
    try {
      const account = await accounts.prepare(runId);
      if (account === null) {
        this.log("пробный заход не нужен: вход аккаунта бота не сохранён");
        return false;
      }
      try {
        const output = await accounts.prepareOutput(runId);
        const network = await this.options.egress.prepare(runId);
        try {
          await this.launch(
            this.probeSpec(runId, account, output, network),
            runId,
            PROBE_PERSON,
            this.options.token,
            { kind: "probe", usesAccount: true },
          );
          hasLaunched = true;
          return true;
        } catch (error) {
          await this.releaseEgress(runId);
          throw error;
        }
      } catch (error) {
        await this.releaseAccount(runId);
        throw error;
      }
    } catch (error) {
      this.log(`пробный заход не начат: ${describeError(error)}`);
      await keepalive.watch.probeCrashed(`проба не запустилась: ${describeError(error)}`);
      return false;
    } finally {
      this.starting -= 1;
      if (!hasLaunched) this.probing = false;
    }
  }

  /**
   * Запустить слежение за входом: состояние с диска, проверка сразу и далее каждые 10 минут —
   * повтор тревоги, если пора, и пробный заход, если пора.
   */
  async startLoginKeepalive(): Promise<void> {
    const keepalive = this.options.loginKeepalive;
    if (keepalive === undefined) return;
    await keepalive.watch.load();
    const check = (): void => {
      inBackground(
        async () => this.checkLogin(),
        (error) => {
          this.log(`проверка входа Google сорвалась: ${describeError(error)}`);
        },
      );
    };
    check();
    this.keepaliveTimer = setInterval(check, keepalive.checkIntervalMs ?? PROBE_CHECK_MS);
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
    const meetings: ManagedMeeting[] = [];
    for (const { kind, id, runId, onBehalfOf, meetingId } of this.running.values()) {
      if (kind === "meeting") meetings.push({ id, runId, onBehalfOf, meetingId });
    }
    return meetings;
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
