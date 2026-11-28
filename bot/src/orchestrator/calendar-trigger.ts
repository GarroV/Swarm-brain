/**
 * Сигнал Swarm запускает забор одного уже спланированного календарного задания (T100).
 * Пропуски пишутся громко и один раз; ошибка забора не подтверждается отправителю.
 * Условный забор и durable start acknowledgement находятся на сервере.
 */
import type { CalendarJob, CalendarSkip, CalendarSweep } from "./calendar-client.ts";
import { isSupportedPlatform } from "./config.ts";
import { describeError } from "./describe-error.ts";
import { RetryableWorkError } from "./work-delivery.ts";
import { refusalDetail, type Refusal } from "./invite-trigger.ts";

/**
 * Сколько не повторять в журнале один и тот же пропуск. Встреча выпадает из окна сама минут через
 * десять; пропуск уровня человека (календарь не подключён) повторяется раз в час — чтобы его было
 * видно в свежем журнале, но не каждую минуту.
 */
const SKIP_MEMORY_MS = 60 * 60_000;

/**
 * Что значит причина пропуска — для журнала оператора. Неизвестная причина пишется как есть.
 */
const SKIP_MEANING: Readonly<Record<string, string>> = {
  no_conference_link: "в событии нет ссылки на звонок",
  unsupported_platform: "звонок не в Google Meet и не в Контур.Толке — бот туда не умеет",
  unrecognized_link: "ссылку на Meet не удалось разобрать",
  declined: "человек отклонил приглашение",
  not_accepted: "человек не ответил «да» на приглашение",
  manual_invite_exists: "бота на эту комнату уже позвали руками",
  calendar_not_connected: "автозапуск включён, а Google-календарь не подключён",
  calendar_token_dead: "доступ к календарю отозван или протух — нужно переподключить",
  calendar_unavailable: "Google-календарь не ответил",
};

export interface CalendarTriggerOptions {
  /**
   * Один проход по календарям воркспейса (`CalendarClient.sweep`).
   */
  readonly sweep: (id?: string) => Promise<CalendarSweep>;
  /**
   * Поднять бота по заданию; возвращает id контейнера.
   */
  readonly start: (job: CalendarJob) => Promise<string>;
  /**
   * Сказать человеку, что бот не придёт (`join_failed`).
   */
  readonly refuse: (job: CalendarJob, detail: string) => Promise<void>;
  readonly complete?: (id: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly now?: () => number;
}

function meetingOf(skip: CalendarSkip): string {
  if (skip.calendar_key === null) return "все встречи";
  const title = skip.title === null ? "" : ` «${skip.title}»`;
  return `встреча ${skip.calendar_key}${title}`;
}

function skipLine(skip: CalendarSkip): string {
  const meaning = SKIP_MEANING[skip.reason] ?? skip.reason;
  const platform = typeof skip.platform === "string" ? ` (${skip.platform})` : "";
  return `БОТ НЕ ПОЙДЁТ по календарю ${String(skip.invited_by)}: ${meetingOf(skip)}${platform} — ${meaning} [${skip.reason}]`;
}

export class CalendarTrigger {
  /**
   * id запущенного задания → конец встречи (мс).
   */
  private readonly started = new Map<string, number>();

  /**
   * Сказанный пропуск → когда можно сказать снова (мс).
   */
  private readonly said = new Map<string, number>();

  private readonly options: CalendarTriggerOptions;

  constructor(options: CalendarTriggerOptions) {
    this.options = options;
  }

  private get nowMs(): number {
    return (this.options.now ?? Date.now)();
  }

  private forget(now: number): void {
    for (const [id, untilMs] of this.started) if (untilMs <= now) this.started.delete(id);
    for (const [key, untilMs] of this.said) if (untilMs <= now) this.said.delete(key);
  }

  private report(skip: CalendarSkip, now: number): void {
    const key = `${String(skip.invited_by)}|${skip.calendar_key ?? "-"}|${skip.reason}`;
    if (this.said.has(key)) return;
    this.said.set(key, now + SKIP_MEMORY_MS);
    this.options.log(skipLine(skip));
  }

  private async refuse(job: CalendarJob, refusal: Refusal): Promise<void> {
    const detail = refusalDetail(refusal);
    this.options.log(
      `ОТКАЗ по встрече ${job.calendar_key} (календарь ${String(job.invited_by)}, ${job.platform}): ${detail}`,
    );
    try {
      await this.options.refuse(job, detail);
    } catch (error) {
      this.options.log(
        `ОТКАЗ НЕ ДОСТАВЛЕН по встрече ${job.calendar_key}: ${describeError(error)} — человек не узнает, что бот не придёт`,
      );
      throw error;
    }
  }

  private async handle(job: CalendarJob): Promise<void> {
    if (this.started.has(job.id)) {
      this.options.log(`задание ${job.id} пришло повторно — второго бота не поднимаю`);
      return;
    }
    if (!isSupportedPlatform(job.platform)) {
      await this.refuse(job, { kind: "platform", platform: job.platform });
      this.started.set(job.id, Date.parse(job.ends_at));
      return;
    }
    try {
      const id = await this.options.start(job);
      this.started.set(job.id, Date.parse(job.ends_at));
      this.options.log(
        `встреча ${job.calendar_key} (календарь ${String(job.invited_by)}) → контейнер ${id}`,
      );
    } catch (error) {
      if (error instanceof RetryableWorkError) throw error;
      await this.refuse(job, { kind: "start_failed", reason: describeError(error) });
      this.started.set(job.id, Date.parse(job.ends_at));
    }
  }

  get startedCount(): number {
    return this.started.size;
  }

  /**
   * По сигналу забрать задание и сказать о пропусках. Ошибка передаётся для повторной доставки.
   */
  async dispatch(id?: string): Promise<void> {
    const now = this.nowMs;
    this.forget(now);
    let sweep: CalendarSweep;
    try {
      sweep = await this.options.sweep(id);
    } catch (error) {
      this.options.log(`забор календарного задания не удался: ${describeError(error)}`);
      throw error;
    }
    for (const problem of sweep.malformed) {
      this.options.log(`ЗАДАНИЕ ПОТЕРЯНО (забрано, но не разобрано): ${problem}`);
    }
    for (const skip of sweep.skipped) this.report(skip, now);
    if (id !== undefined && sweep.malformed.length > 0)
      throw new Error("malformed targeted calendar job");
    for (const job of sweep.jobs) await this.handle(job);
    if (id !== undefined) await this.options.complete?.(id);
  }
}
