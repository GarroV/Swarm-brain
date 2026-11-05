/**
 * Слетевший вход Google бота — СОСТОЯНИЕ, а не событие (#1140, решение владельца 06.11.2026;
 * канон — docs/decisions/2026-11-05-persistent-service-alerts.md).
 *
 * Одно сообщение о событии теряется (человек был занят, канал мигнул), а вход остаётся сломанным
 * ещё неделю — ровно так с 28.10 по 05.11 встречи молча срывались. Поэтому состояние живёт в
 * файле и переживает перезапуск службы:
 *  - первый `account_signin_required` из запуска или пробы — сообщение сразу;
 *  - пока сломано — повтор каждые 4 часа, но только с 08:00 до 22:00 по Белграду (ночью владельца
 *    не будим);
 *  - вход снова работает — ОДНО сообщение «восстановился», и только если о поломке сообщение
 *    ушло. Удачная проба при целом входе не шлёт ничего.
 *
 * Тексты утверждены владельцем 06.11.2026 («ок»); менять — только с его «да», поэтому они в одной
 * функции. Канал недоступен или не настроен — громкая строка журнала, бот работает дальше.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { SerialQueue } from "./serial-queue.ts";

const TIME_ZONE = "Europe/Belgrade";
export const REPEAT_EVERY_MS = 4 * 60 * 60 * 1000;
/**
Повторы разрешены с 08:00 (включительно) до 22:00 (исключительно) по Белграду.
*/
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 8;
/**
Проба, не давшая вердикта (упала), повторяется через час; после стольких подряд — тревога.
*/
const PROBE_RETRY_MS = 60 * 60 * 1000;
const PROBE_CRASHES_TO_ALERT = 2;

type LoginAlertKind = "broken" | "recovered";

/**
 * Утверждённые владельцем тексты. `reason` — короткая причина из вердикта.
 */
export function loginAlertText(kind: LoginAlertKind, reason: string): string {
  if (kind === "recovered") return "🟢 Scriba: вход Google бота снова работает.";
  return (
    "🔴 Scriba: слетел вход Google у бота — встречи в Meet не записываются. " +
    `Причина: ${reason}. Нужен перелогин бота. Напоминаю каждые 4 часа, пока не починим.`
  );
}

export interface LoginStatus {
  /**
  Вход сейчас считается сломанным.
  */
  readonly broken: boolean;
  readonly reason: string | null;
  /**
  Когда ушло последнее сообщение о поломке; `null` — ещё ни одного.
  */
  readonly lastAlertAt: number | null;
  /**
  Последний раз, когда Google принял вход (запуск или проба).
  */
  readonly lastOkAt: number | null;
  /**
  Последняя попытка пробы, удачная или нет.
  */
  readonly lastProbeAt: number | null;
  readonly probeCrashes: number;
}

export const INITIAL_STATUS: LoginStatus = {
  broken: false,
  reason: null,
  lastAlertAt: null,
  lastOkAt: null,
  lastProbeAt: null,
  probeCrashes: 0,
};

/**
Час суток в Белграде для момента `at` (мс).
*/
function belgradeHour(at: number): number {
  return belgradeClock(at).hour;
}

function belgradeClock(at: number): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const pick = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: pick("hour"), minute: pick("minute"), second: pick("second") };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Пора ли пробному заходу. Без сломанного входа — раз в сутки в `probeHour` по Белграду и сразу,
 * если последний удачный заход (встреча или проба) старше суток либо проб ещё не было; после
 * упавшей пробы — через час. Со сломанным входом — каждый час: починенный вход должен
 * подтвердиться и дать сообщение о восстановлении, а не ждать следующей встречи.
 */
export function isProbeDue(status: LoginStatus, now: number, probeHour: number): boolean {
  const lastProbe = status.lastProbeAt;
  if (lastProbe === null) return true;
  if (status.broken || status.probeCrashes > 0) return now - lastProbe >= PROBE_RETRY_MS;
  if (status.lastOkAt === null || now - status.lastOkAt >= DAY_MS) return true;
  const clock = belgradeClock(now);
  const sinceSlotMs =
    (((clock.hour - probeHour + 24) % 24) * 60 + clock.minute) * 60_000 + clock.second * 1000;
  return lastProbe < now - sinceSlotMs;
}

export function isQuietHour(at: number): boolean {
  const hour = belgradeHour(at);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

export interface LoginWatchOptions {
  /**
  Файл состояния; переживает перезапуск.
  */
  readonly file: string;
  /**
  Канал владельцу; `undefined` — не настроен.
  */
  readonly send?: (text: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly now?: () => number;
}

function isNumberOrNull(item: unknown): boolean {
  return item === null || typeof item === "number";
}

function isStatus(value: unknown): value is LoginStatus {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.broken === "boolean" &&
    (record.reason === null || typeof record.reason === "string") &&
    isNumberOrNull(record.lastAlertAt) &&
    isNumberOrNull(record.lastOkAt) &&
    isNumberOrNull(record.lastProbeAt) &&
    typeof record.probeCrashes === "number"
  );
}

export class LoginWatch {
  readonly #options: LoginWatchOptions;
  #status: LoginStatus = INITIAL_STATUS;
  // Переходы состояния идут по одному: два запуска, закончившихся разом, не должны слать дважды.
  readonly #queue = new SerialQueue();

  constructor(options: LoginWatchOptions) {
    this.#options = options;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #save(): Promise<void> {
    const temporary = `${this.#options.file}.tmp`;
    await mkdir(path.dirname(this.#options.file), { recursive: true });
    await writeFile(temporary, JSON.stringify(this.#status), { mode: 0o600 });
    await rename(temporary, this.#options.file);
  }

  async #commit(next: LoginStatus): Promise<void> {
    this.#status = next;
    try {
      await this.#save();
    } catch (error) {
      this.#options.log(`состояние входа Google не сохранено: ${String(error)}`);
    }
  }

  /**
  Отправить; `true` — сообщение ушло. Сбой или нет канала — громкая строка.
  */
  async #deliver(text: string): Promise<boolean> {
    const { send, log } = this.#options;
    if (send === undefined) {
      log(`ТРЕВОГА ВЛАДЕЛЬЦУ НЕ ОТПРАВЛЕНА — канал FURCA не настроен: ${text}`);
      return false;
    }
    try {
      await send(text);
      log(`тревога владельцу ушла: ${text}`);
      return true;
    } catch (error) {
      log(`ТРЕВОГА ВЛАДЕЛЬЦУ НЕ УШЛА (${String(error)}): ${text}`);
      return false;
    }
  }

  async #alertBroken(reason: string, now: number): Promise<void> {
    const isSent = await this.#deliver(loginAlertText("broken", reason));
    // Не ушло — lastAlertAt остаётся прежним, и ближайший `tick` попробует снова.
    await this.#commit({ ...this.#status, lastAlertAt: isSent ? now : this.#status.lastAlertAt });
  }

  async #signin(reason: string): Promise<void> {
    if (this.#status.broken) return;
    await this.#commit({ ...this.#status, broken: true, reason, probeCrashes: 0 });
    await this.#alertBroken(reason, this.#now());
  }

  async #ok(): Promise<void> {
    const now = this.#now();
    const wasAlerted = this.#status.broken && this.#status.lastAlertAt !== null;
    await this.#commit({
      ...this.#status,
      broken: false,
      reason: null,
      lastAlertAt: null,
      lastOkAt: now,
      probeCrashes: 0,
    });
    // Восстановление — только после сообщения о поломке; без него «снова работает» было бы шумом.
    if (wasAlerted) await this.#deliver(loginAlertText("recovered", ""));
  }

  async #tick(): Promise<void> {
    const { broken, reason, lastAlertAt } = this.#status;
    if (!broken) return;
    const now = this.#now();
    const isFirstRetry = lastAlertAt === null;
    // Первое сообщение, которое не ушло, ждать утра не должно; повторы — только днём.
    const isDue = isFirstRetry || (now - lastAlertAt >= REPEAT_EVERY_MS && !isQuietHour(now));
    if (!isDue) return;
    await this.#alertBroken(reason ?? "причина не названа", now);
  }

  async #probeFailed(reason: string): Promise<void> {
    const crashes = this.#status.probeCrashes + 1;
    this.#options.log(`проба входа Google не состоялась (${String(crashes)} подряд): ${reason}`);
    await this.#commit({ ...this.#status, probeCrashes: crashes });
    if (crashes >= PROBE_CRASHES_TO_ALERT) await this.#signin(`проба входа не проходит: ${reason}`);
  }

  async #markProbe(): Promise<void> {
    await this.#commit({ ...this.#status, lastProbeAt: this.#now() });
  }

  async #enqueue(task: () => Promise<void>): Promise<void> {
    return this.#queue.run(task);
  }

  get status(): LoginStatus {
    return this.#status;
  }

  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#options.file, "utf8"));
      if (isStatus(parsed)) this.#status = parsed;
      else this.#options.log("состояние входа Google повреждено — начинаю с чистого");
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== "ENOENT") {
        this.#options.log(
          `состояние входа Google не прочитано — начинаю с чистого: ${String(error)}`,
        );
      }
    }
  }

  /**
  Запуск встречи или проба: Google просит вход.
  */
  async signinRequired(reason: string): Promise<void> {
    return this.#enqueue(async () => this.#signin(reason));
  }

  /**
  Запуск встречи или проба: Google принял вход.
  */
  async accepted(): Promise<void> {
    return this.#enqueue(async () => this.#ok());
  }

  /**
  Раз в несколько минут: повтор тревоги, если пора.
  */
  async tick(): Promise<void> {
    return this.#enqueue(async () => this.#tick());
  }

  /**
  Проба вынесла вердикт (удачный или «слетел»): время пробы фиксируется.
  */
  async probeFinished(): Promise<void> {
    return this.#enqueue(async () => this.#markProbe());
  }

  /**
  Проба не состоялась (упала, страница не Meet).
  */
  async probeCrashed(reason: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#markProbe();
      await this.#probeFailed(reason);
    });
  }
}
