/**
 * Громкие отказы наружу: интерфейс уведомителя.
 *
 * Виды и привязка списаны с контракта блока notices (`POST /meeting-notice`,
 * docs/furca/blocks/notices.md). Встречные виды несут `meeting_id` — поэтому процесс встречи
 * сначала делает `meeting-claim` и только потом заходит в звонок. До-встречные виды несут
 * ключ календарной встречи. Клиент сервера — `notice-client.ts`.
 */
import { describeError } from "./describe-error.ts";

type MeetingNoticeKind =
  | "door_waiting"
  | "door_denied"
  | "captcha"
  | "no_audio"
  | "recording_lost"
  | "container_died"
  | "join_failed";

type PreMeetingNoticeKind = "no_conference_link" | "no_owner";

export type Notice =
  | { readonly kind: MeetingNoticeKind; readonly meetingId: string; readonly detail?: string }
  | {
      readonly kind: PreMeetingNoticeKind;
      readonly meetingKey: string;
      readonly title?: string;
      readonly detail?: string;
    };

/**
 * Ответ сервера на нотису. `shouldLeave` — решение потолка двери, его держит сервер.
 */
export interface NoticeResult {
  readonly delivered: boolean;
  readonly shouldLeave: boolean;
}

export interface Notifier {
  notify(notice: Notice): Promise<NoticeResult>;
}

/**
 * Одна строка на нотису: вид, привязка и деталь. Формат постоянный — его ищут глазами в
 * журнале контейнера и оркестратора.
 */
export function describeNotice(notice: Notice): string {
  const target =
    "meetingId" in notice ? `meeting_id=${notice.meetingId}` : `meeting_key=${notice.meetingKey}`;
  const detail = notice.detail === undefined ? "" : ` detail=${JSON.stringify(notice.detail)}`;
  return `NOTICE ${notice.kind} ${target}${detail}`;
}

/**
 * Обёртка, которая пишет каждую нотису и её исход в журнал: сервер шлёт человеку сообщение,
 * а журнал контейнера остаётся единственным местом, где видно, что и когда ушло. Сбой
 * доставки пишется и пробрасывается дальше — решать, что делать, вызывающему.
 */
export class JournaledNotifier implements Notifier {
  private readonly inner: Notifier;

  private readonly log: (line: string) => void;

  constructor(inner: Notifier, log: (line: string) => void) {
    this.inner = inner;
    this.log = log;
  }

  async notify(notice: Notice): Promise<NoticeResult> {
    try {
      const result = await this.inner.notify(notice);
      this.log(
        `${describeNotice(notice)} delivered=${String(result.delivered)} should_leave=${String(result.shouldLeave)}`,
      );
      return result;
    } catch (error) {
      this.log(`${describeNotice(notice)} НЕ доставлено: ${describeError(error)}`);
      throw error;
    }
  }
}
