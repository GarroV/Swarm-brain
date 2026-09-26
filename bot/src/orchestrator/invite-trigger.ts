/**
 * Вход «ручной запуск» (решение D017): человек вставил в вебе ссылку на созвон — сервер завёл
 * приглашение, этот цикл его забирает (`POST /meeting-invite`) и поднимает бота от имени
 * позвавшего. Основной путь — календарный (T100); этот — постоянный запасной (D015).
 *
 * Правило одно, и оно про тишину: приглашение, по которому бот не пошёл, обязано кончиться
 * отказом, который человек увидит. Площадка без адаптера (Контур.Толк, Zoom) и контейнер,
 * который не поднялся, уходят в `refuse` — оркестратор заявляет встречу по приглашению и
 * шлёт `join_failed` с причиной на EN и RU. Отказ, который не доставился, и приглашение, не
 * прошедшее разбор, пишутся в журнал громко: сделать больше тут уже нечего.
 *
 * Одно приглашение не поднимает двух ботов: сервер отдаёт каждое один раз (условный UPDATE),
 * а цикл вдобавок помнит, что уже запускал, до срока приглашения — на случай, если сервер
 * когда-нибудь отдаст его повторно.
 */
import type { MeetingInvite } from "../swarm-client/contract.ts";
import type { TakenInvites } from "../swarm-client/invites.ts";
import { describeError } from "./describe-error.ts";

/**
 * Предел `detail` у `meeting-notice` (`MAX_DETAIL_CHARS` в `_shared/notices.ts`).
 */
export const MAX_REFUSAL_DETAIL_CHARS = 300;
const DEFAULT_INTERVAL_MS = 5000;
const SUPPORTED_PLATFORM = "meet";

const PLATFORM_NAMES: Readonly<Record<string, { en: string; ru: string }>> = {
  kontur: { en: "Kontur.Talk", ru: "Контур.Толк" },
  zoom: { en: "Zoom", ru: "Zoom" },
};

export type Refusal =
  | { readonly kind: "platform"; readonly platform: string }
  | { readonly kind: "start_failed"; readonly reason: string };

/**
 * Причина отказа для человека: сначала английский (язык продукта по умолчанию), затем русский.
 * Уходит в `detail` нотисы `join_failed` — сервер ставит её под шаблоном отказа.
 */
export function refusalDetail(refusal: Refusal): string {
  if (refusal.kind === "platform") {
    const name = PLATFORM_NAMES[refusal.platform] ?? {
      en: `«${refusal.platform}»`,
      ru: `«${refusal.platform}»`,
    };
    return (
      `${name.en} calls aren't supported yet — scriba only joins Google Meet for now. ` +
      `/ Звонки ${name.ru} бот пока не умеет — scriba заходит только в Google Meet.`
    );
  }
  const en = "scriba could not start for this call: ";
  const ru = " / scriba не смог запуститься на этот звонок.";
  const room = MAX_REFUSAL_DETAIL_CHARS - en.length - ru.length;
  const reason =
    refusal.reason.length <= room ? refusal.reason : `${refusal.reason.slice(0, room - 1)}…`;
  return `${en}${reason}${ru}`;
}

export interface InviteTriggerOptions {
  /**
   * Забрать ожидающие приглашения (`InviteClient.take`).
   */
  readonly take: () => Promise<TakenInvites>;
  /**
   * Поднять бота по приглашению; возвращает id контейнера.
   */
  readonly start: (invite: MeetingInvite) => Promise<string>;
  /**
   * Сказать позвавшему, что бот не придёт (`refuseInvite`).
   */
  readonly refuse: (invite: MeetingInvite, detail: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly intervalMs?: number;
  readonly now?: () => number;
}

export class InviteTrigger {
  /**
   * id запущенного приглашения → срок приглашения (мс): дольше помнить незачем.
   */
  private readonly remembered = new Map<string, number>();

  private timer: NodeJS.Timeout | undefined;

  private running: Promise<void> | null = null;

  private isStarted = false;

  constructor(private readonly options: InviteTriggerOptions) {}

  private get nowMs(): number {
    return (this.options.now ?? Date.now)();
  }

  private forget(): void {
    const now = this.nowMs;
    for (const [id, expiresMs] of this.remembered) {
      if (expiresMs <= now) this.remembered.delete(id);
    }
  }

  private async refuse(invite: MeetingInvite, refusal: Refusal): Promise<void> {
    const detail = refusalDetail(refusal);
    this.options.log(
      `ОТКАЗ по приглашению ${invite.id} (от ${String(invite.invited_by)}, ${invite.platform}): ${detail}`,
    );
    try {
      await this.options.refuse(invite, detail);
    } catch (error) {
      this.options.log(
        `ОТКАЗ НЕ ДОСТАВЛЕН по приглашению ${invite.id}: ${describeError(error)} — человек не узнает, что бот не придёт`,
      );
    }
  }

  private async handle(invite: MeetingInvite): Promise<void> {
    if (this.remembered.has(invite.id)) {
      this.options.log(`приглашение ${invite.id} пришло повторно — второго бота не поднимаю`);
      return;
    }
    this.remembered.set(invite.id, Date.parse(invite.expires_at));

    if (invite.platform !== SUPPORTED_PLATFORM) {
      await this.refuse(invite, { kind: "platform", platform: invite.platform });
      return;
    }
    try {
      const id = await this.options.start(invite);
      this.options.log(
        `приглашение ${invite.id} (от ${String(invite.invited_by)}) → контейнер ${id}`,
      );
    } catch (error) {
      await this.refuse(invite, { kind: "start_failed", reason: describeError(error) });
    }
  }

  get rememberedCount(): number {
    return this.remembered.size;
  }

  /**
   * Один опрос: забрать и разобрать всё забранное. Не бросает — сбой пишется в журнал.
   */
  async pollOnce(): Promise<void> {
    this.forget();
    let taken: TakenInvites;
    try {
      taken = await this.options.take();
    } catch (error) {
      this.options.log(`опрос приглашений не удался: ${describeError(error)}`);
      return;
    }
    for (const problem of taken.malformed) {
      this.options.log(`ПРИГЛАШЕНИЕ ПОТЕРЯНО (забрано, но не разобрано): ${problem}`);
    }
    for (const invite of taken.invites) await this.handle(invite);
  }

  /**
   * Опрашивать по кругу: следующий опрос — через интервал после конца предыдущего, так что
   * медленный сервер не наслаивает опросы друг на друга.
   */
  start(): void {
    if (this.isStarted) throw new Error("опрос приглашений уже запущен");
    this.isStarted = true;
    const cycle = async (): Promise<void> => {
      await this.pollOnce();
      this.running = null;
      if (this.isStarted) {
        this.timer = setTimeout(loop, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
      }
    };
    const loop = (): void => {
      this.running = cycle();
    };
    loop();
  }

  /**
   * Перестать опрашивать; идущий опрос доводится до конца — забранное не бросается.
   */
  async close(): Promise<void> {
    this.isStarted = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
