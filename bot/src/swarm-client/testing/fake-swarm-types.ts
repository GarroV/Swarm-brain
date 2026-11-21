// Data contracts of the test-only HTTP double.
import type { ClaimDecision, CurrentMeetingResponse, SpeakerSpan } from "../contract.ts";

export interface FakeSwarmOptions {
  /**
  Токен, который сервер считает валидным. По умолчанию "test-bot-token".
  */
  readonly token?: string;
  /**
  Кого сервер ждёт в X-On-Behalf-Of. По умолчанию 744230399.
  */
  readonly onBehalfOf?: number;
  /**
  Порт. 0 (по умолчанию) — эфемерный, ОС выберет сама.
  */
  readonly port?: number;
  /**
  Что отвечает claim. По умолчанию "transcribe".
  */
  readonly decision?: ClaimDecision;
  /**
  Ответ meeting-current. По умолчанию — встреча с join_url на Meet.
  */
  readonly current?: CurrentMeetingResponse;
  /**
  Как настоящий сервер для служебного агента (D017): ручная заявка без верного приглашения — 403.
  По умолчанию выключено — прежние тесты заявляются вручную без приглашений.
  */
  readonly requiresInvites?: boolean;
  /**
  Как настоящий сервер после T165: за человека двери пускают только пропуск встречи
  (`grant_token` из `meeting-invite`), общий токен агента — 403. По умолчанию выключено —
  прежние тесты ходят общим токеном.
  */
  readonly requiresGrants?: boolean;
}

/**
Приглашение бота в двойнике — те же поля, что отдаёт `POST /meeting-invite`.
*/
export interface FakeInvite {
  readonly id: string;
  readonly invited_by: number;
  readonly join_url: string;
  readonly platform: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly grant_token: string;
}

export interface InviteRecord {
  readonly invite: FakeInvite;
  taken: boolean;
  used: boolean;
}

export interface RecordedRequest {
  readonly method: string;
  /**
  Путь без query, например "/meeting-ingest".
  */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly authorization: string | null;
  readonly onBehalfOf: string | null;
  /**
  Разобранное тело: JSON-объект, либо разбор multipart (см. IngestRecord), либо null.
  */
  readonly body: unknown;
  readonly status: number;
}

/**
Часть дорожки, как её увидел сервер: имя поля, сдвиг, размер и содержимое файла.
*/
export interface IngestPart {
  readonly name: string;
  readonly offset: number;
  readonly bytes: number;
  readonly content: string;
}

/**
Что сервер увидел в multipart-форме meeting-ingest.
*/
export interface IngestRecord {
  readonly meeting_id: string;
  readonly sys: readonly IngestPart[];
  readonly mic: readonly IngestPart[];
  /**
  Разобранное поле speakers; undefined — поля не было.
  */
  readonly speakers?: readonly SpeakerSpan[];
}

export interface FakeSwarm {
  readonly url: string;
  readonly port: number;
  /**
  Все обработанные запросы по порядку.
  */
  readonly requests: readonly RecordedRequest[];
  /**
  Только успешно принятые ingest-и (status 202).
  */
  readonly ingested: readonly IngestRecord[];
  /**
  Запросы к одному пути: fake.requestsTo("/meeting-ingest").length
  */
  requestsTo(path: string): readonly RecordedRequest[];
  /**
  Следующие n запросов (любые) отвечают этим статусом, не доходя до логики. Для проверки ретраев.
  */
  failNext(count: number, status: number, options?: { retryAfterSeconds?: number }): void;
  /**
  Что отвечать claim дальше.
  */
  setDecision(decision: ClaimDecision): void;
  /**
  Состояние встреч для meeting-status: id → { summary_status, status }.
  */
  setStatus(id: string, value: { summary_status?: string | null; status?: string | null }): void;
  /**
  Человек вставил ссылку в вебе: заводит приглашение. По умолчанию — от того, кого сервер ждёт в
  X-On-Behalf-Of, на Meet, со сроком 15 минут.
  */
  addInvite(input: {
    joinUrl: string;
    platform?: string;
    invitedBy?: number;
    expiresInMs?: number;
  }): FakeInvite;
  /**
  Признать пропуск, выданный не забором приглашения здесь: засеянный в настоящую базу или собранный
  смоуком на месте (T165).
  */
  acceptGrant(token: string): void;
  /**
  Забрано ли приглашение оркестратором и погашено ли заявкой бота. Неизвестный id — ошибка.
  */
  inviteState(id: string): { taken: boolean; used: boolean };
  /**
  Закрыть сервер и дождаться закрытия. Идемпотентно.
  */
  close(): Promise<void>;
}
