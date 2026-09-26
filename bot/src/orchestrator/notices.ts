/**
 * Громкие отказы наружу: интерфейс уведомителя.
 *
 * Виды и привязка списаны с контракта блока notices (`POST /meeting-notice`,
 * docs/furca/blocks/notices.md в ветке feat/notices). Встречные виды несут `meeting_id` —
 * поэтому процесс встречи сначала делает `meeting-claim` и только потом заходит в звонок.
 * До-встречные виды несут ключ календарной встречи.
 *
 * Клиента `meeting-notice` здесь пока нет: блок notices ещё не влит в ствол. До слияния
 * работает `LogNotifier` — он не шлёт в Telegram, но и не молчит: каждая нотиса уходит в
 * журнал строкой с пометкой, что человек её НЕ получил.
 */

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
 * Уведомитель до слияния notices: пишет в журнал и честно говорит, что человек сообщения
 * не получил. `shouldLeave` не решает — решение потолка двери остаётся за процессом встречи.
 */
export class LogNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void) {}

  notify(notice: Notice): Promise<NoticeResult> {
    this.log(`${describeNotice(notice)} (НЕ доставлено: клиент meeting-notice ещё не подключён)`);
    return Promise.resolve({ delivered: false, shouldLeave: false });
  }
}
