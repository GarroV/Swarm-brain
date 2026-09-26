/**
 * Форма запросов и ответов пяти эндпоинтов Swarm — ровно та, которую сервер уже принимает
 * от `bumblebee`. Типы списаны с серверного кода, а не придуманы:
 *
 *  - `supabase/functions/meeting-current/index.ts` + `join-link.ts` — `CurrentMeetingResponse`;
 *  - `supabase/functions/meeting-claim/index.ts` (`ClaimBody`, ответ в конце файла);
 *  - `supabase/functions/meeting-ingest/index.ts` (`buildTrackParts`, поля формы);
 *  - `supabase/functions/meeting-heartbeat/write.ts` (`HeartbeatBody`);
 *  - `supabase/functions/meeting-status/index.ts` (`?ids=` → `statuses`);
 *  - `supabase/functions/meeting-invite/index.ts` (`COLUMNS`, `invites`) — `MeetingInvite`;
 *    поля `invite_id`/`join_url` заявки — `meeting-claim/agent-scope.ts` (решение D017).
 *
 * Имена полей — snake_case, как на проводе: переименование в camelCase здесь стоило бы
 * ровно одного молчаливого расхождения с сервером. За тем, что имена не разъехались,
 * следит `server-contract.test.ts` — он читает серверные исходники.
 */

/**
 * Как клиент увидел встречу. Бот ходит с `calendar` (событие из `meeting-current`).
 */
type IdentityKind = "calendar" | "room" | "manual";

/**
 * Ответ арбитража: транскрибируем мы или уже пишет кто-то полнее.
 */
export type ClaimDecision = "transcribe" | "defer";

/**
 * Площадки, ссылку на которые сервер узнаёт в лицо. Неизвестный хост — `null`, а не догадка.
 */
export type ConferencePlatform = "meet" | "kontur" | "zoom";

export interface Attendee {
  readonly name?: string | null;
  readonly email?: string | null;
}

/**
 * Встреча, которую сервер считает идущей сейчас.
 */
export interface CurrentMeeting {
  readonly identity_kind: string;
  readonly identity_key: string;
  readonly title: string | null;
  readonly attendees: readonly Attendee[];
  readonly started_at: string;
  readonly ended_at: string;
  /**
   * Ссылка «зайти в звонок»; `null` — сервер её не нашёл, причина в `reason`.
   */
  readonly join_url: string | null;
  readonly platform: ConferencePlatform | null;
  readonly reason?: "no_conference_link";
}

export interface CurrentMeetingResponse {
  readonly meeting: CurrentMeeting | null;
  /**
   * `google_not_connected` | `token_refresh_failed` | `calendar_api_error` | `no_ongoing_event`.
   */
  readonly reason?: string;
}

/**
 * Тело `POST /meeting-claim`. Поля рекордера, которых у бота нет, просто не отправляются.
 */
export interface ClaimRequest {
  readonly identity_kind: IdentityKind;
  readonly identity_key: string;
  readonly started_at?: string;
  readonly ended_at?: string;
  readonly title?: string;
  readonly attendees?: readonly Attendee[];
  readonly agent_version?: string;
  /**
   * Длительность записи претендента (сек) — основа арбитража «полнее, а не первее».
   * Бот заявляется до записи, поэтому в первом claim это 0.
   */
  readonly recorded_seconds?: number;
  /**
   * Приглашение, по которому служебный агент заводит ручную встречу (решение D017): без него
   * сервер ручную заявку агента отвергает 403.
   */
  readonly invite_id?: string;
  /**
   * Ссылка на звонок из того же приглашения — сервер сверяет комнату с приглашением.
   */
  readonly join_url?: string;
}

/**
 * Приглашение бота, как его отдаёт `POST /meeting-invite` (решение D017): человек вставил в
 * вебе ссылку на созвон, оркестратор забрал приглашение и запускает бота за `invited_by`.
 * Каждое приглашение сервер отдаёт ровно один раз.
 */
export interface MeetingInvite {
  readonly id: string;
  /**
   * Telegram-id того, кто позвал: бот действует от его имени (`X-On-Behalf-Of`).
   */
  readonly invited_by: number;
  readonly join_url: string;
  /**
   * Площадка по ссылке. Строка, а не `ConferencePlatform`: новую площадку сервер может начать
   * принимать раньше, чем бот научится в неё заходить, — и это отказ бота, а не сбой разбора.
   */
  readonly platform: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface ClaimResponse {
  readonly meeting_id: string;
  readonly decision: ClaimDecision;
  readonly lease_ttl_sec: number;
  readonly held_by: number | null;
  readonly held_by_name: string | null;
}

/**
 * Интервал, в котором говорил один человек. Времена — секунды от начала записи
 * (тот же ноль, что у `offset` первой части дорожки).
 * Контракт блока `ingest-speakers`: `docs/furca/plan.md`, «`ingest-speakers` → `swarm-client`».
 */
export interface SpeakerSpan {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

export interface IngestResponse {
  readonly ok: boolean;
  readonly meeting_id: string;
  readonly web_url: string;
  /**
   * `processing` | `already_processed` | `skipped_human_edit`.
   */
  readonly summary_status: string;
}

export interface HeartbeatRequest {
  readonly recording: boolean;
  readonly version: number;
  readonly on_call?: boolean;
  readonly meeting_key?: string;
  /**
   * Встреча, которую бот пишет (id из `meeting-claim`). Удар ложится в её строку — у каждой
   * встречи своя тишина (D018). До claim встречи нет, и поле не отправляется.
   */
  readonly meeting_id?: string;
}

export interface MeetingStatusItem {
  readonly id: string;
  readonly summary_status: string | null;
  readonly status: string | null;
}

/**
 * Жёсткий предел `meeting-ingest`: часть больше — 413, и повторять бессмысленно.
 */
export const INGEST_PART_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Имена полей формы `meeting-ingest`. Сервер ищет файлы частей по именам из манифеста.
 */
export const INGEST_FIELD = {
  meetingId: "meeting_id",
  systemManifest: "sys_parts",
  micManifest: "mic_parts",
  speakers: "speakers",
} as const;

/**
 * Встреча опубликована в базу: локальный бэкап аудио больше не нужен.
 */
export const PUBLISHED_STATUS = "in_base";
