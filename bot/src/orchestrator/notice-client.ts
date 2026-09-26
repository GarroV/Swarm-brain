/**
 * Клиент `POST /meeting-notice`: громкий отказ доходит до человека в Telegram.
 *
 * Контракт — docs/furca/blocks/notices.md. Главное для потребителя:
 *  - встречные виды несут `meeting_id` (поэтому claim идёт раньше захода), до-встречные —
 *    `meeting_key` и своё `title`;
 *  - номер отправки и потолок считает сервер: `attempt` в теле запрещён, решение «уходи от
 *    двери» приходит полем `should_leave`;
 *  - получатель — всегда человек из `X-On-Behalf-Of`, из тела он не берётся.
 *
 * Сбой доставки — не повод молчать: ответ сервера целиком уходит в журнал через исключение,
 * а процесс встречи пишет его и идёт дальше.
 */
import type { Notice, NoticeResult, Notifier } from "./notices.ts";

const TIMEOUT_MS = 30_000;
const CONFLICT = 409;
const BODY_TAIL = 300;

export interface NoticeClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly onBehalfOf: number;
  readonly fetch?: typeof globalThis.fetch;
}

function requestBody(notice: Notice): Record<string, string> {
  const detail = notice.detail === undefined ? {} : { detail: notice.detail };
  if ("meetingId" in notice) {
    return { kind: notice.kind, meeting_id: notice.meetingId, ...detail };
  }
  const title = notice.title === undefined ? {} : { title: notice.title };
  return { kind: notice.kind, meeting_key: notice.meetingKey, ...title, ...detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class NoticeClient implements Notifier {
  private readonly baseUrl: string;

  private readonly config: NoticeClientConfig;

  constructor(config: NoticeClientConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl;
  }

  async notify(notice: Notice): Promise<NoticeResult> {
    const doFetch = this.config.fetch ?? globalThis.fetch;
    const response = await doFetch(`${this.baseUrl}/meeting-notice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "X-On-Behalf-Of": String(this.config.onBehalfOf),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(notice)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();

    // Потолок исчерпан или параллельный вызов уже шлёт: сообщение не наше, но уходить пора.
    if (response.status === CONFLICT) return { delivered: false, shouldLeave: true };

    if (!response.ok) {
      throw new Error(
        `meeting-notice ${notice.kind}: HTTP ${String(response.status)} ${text.slice(0, BODY_TAIL)}`,
      );
    }
    const body = parseJson(text);
    if (!isRecord(body) || body.ok !== true || body.delivered !== true) {
      throw new Error(
        `meeting-notice ${notice.kind}: ответ не той формы ${text.slice(0, BODY_TAIL)}`,
      );
    }
    if (typeof body.should_leave !== "boolean") {
      throw new TypeError(`meeting-notice ${notice.kind}: в ответе нет should_leave`);
    }
    return { delivered: true, shouldLeave: body.should_leave };
  }
}
