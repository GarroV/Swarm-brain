/**
 * Клиент пяти эндпоинтов Swarm.
 *
 * Всё, что знает о проводе, живёт здесь: адреса, заголовки, разбор ответов, классификация
 * сбоев. Очередь и сессия работают уже с методами этого класса и про HTTP не знают.
 *
 * Личность: токен бота (`kind: "bot"`) сам по себе не даёт прав — каждый запрос обязан
 * назвать человека, от имени которого бот действует (`X-On-Behalf-Of`). Это не деталь
 * реализации, а принцип №3 проекта: владельцем записи остаётся живой человек.
 */
import {
  type ClaimRequest,
  type ClaimResponse,
  type CurrentMeetingResponse,
  type HeartbeatRequest,
  INGEST_FIELD,
  type IngestResponse,
  type MeetingStatusItem,
  type SpeakerSpan,
} from "./contract.ts";
import {
  parseRetryAfterMs,
  SwarmHttpError,
  SwarmProtocolError,
  SwarmTransportError,
} from "./errors.ts";
import { parseCurrentMeeting, parseIngestResponse } from "./responses.ts";
import { type RetryOptions, withRetry } from "./retry.ts";

/**
 * Часть дорожки, готовая к отправке. `body` — ленивый `Blob` с диска, а не 25 МБ в памяти.
 */
export interface UploadPart {
  /**
   * Имя поля формы и ключ в манифесте: `sys_0`, `sys_1`, …
   */
  readonly name: string;
  /**
   * Сдвиг от начала записи в секундах.
   */
  readonly offset: number;
  readonly body: Blob;
}

export interface IngestInput {
  readonly meetingId: string;
  readonly system: readonly UploadPart[];
  readonly mic?: readonly UploadPart[];
  /**
   * Таймлайн говорящих. Пустой — поле не отправляется вовсе, сервер деградирует мягко.
   */
  readonly speakers?: readonly SpeakerSpan[];
}

export interface SwarmClientConfig {
  /**
   * Корень функций, например `https://<project>.supabase.co/functions/v1`.
   */
  readonly baseUrl: string;
  /**
   * Токен служебного агента. Живёт в секретах контейнера, не в коде.
   */
  readonly token: string;
  /**
   * Telegram-id человека, от имени которого действует бот.
   */
  readonly onBehalfOf: number;
  /**
   * Потолок на обычный запрос.
   */
  readonly timeoutMs?: number;
  /**
   * Потолок на выгрузку аудио: она законно идёт минутами.
   */
  readonly uploadTimeoutMs?: number;
  readonly retry?: RetryOptions;
  /**
   * Подменяется в тестах, где сеть нужна не настоящая. По умолчанию — глобальный `fetch`.
   */
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60_000;

interface RequestSpec {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /**
   * Тело пересобирается на КАЖДУЮ попытку: отправленное тело второй раз не отправишь.
   */
  readonly body?: () => FormData | string;
  readonly contentType?: string;
  readonly timeoutMs?: number;
}

/**
 * Хвостовые слэши срезаются циклом, а не регуляркой `/+$`: на строке из одних слэшей
 * такая регулярка уходит в перебор с возвратами (`sonarjs/super-linear-regex`).
 */
function trimTrailingSlashes(raw: string): string {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === "/") end -= 1;
  return raw.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Элемент `meeting-status`. Проверяем на границе, а не верим на слово: без `id` он
 * бесполезен, и молча положить его в карту значит потом искать бэкап по `undefined`.
 */
function isStatusItem(value: unknown): value is MeetingStatusItem {
  return isRecord(value) && typeof value.id === "string";
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function appendTrack(form: FormData, manifestField: string, parts: readonly UploadPart[]): void {
  if (parts.length === 0) return;
  for (const part of parts) {
    form.set(part.name, part.body, `${part.name}.m4a`);
  }
  const manifest = parts.map((part) => ({ name: part.name, offset: part.offset }));
  form.set(manifestField, JSON.stringify(manifest));
}

function buildIngestForm(input: IngestInput, mic: readonly UploadPart[]): FormData {
  const form = new FormData();
  form.set(INGEST_FIELD.meetingId, input.meetingId);
  appendTrack(form, INGEST_FIELD.systemManifest, input.system);
  if (mic.length > 0) appendTrack(form, INGEST_FIELD.micManifest, mic);
  // Пустой таймлайн поля не порождает: сервер обязан вести себя как раньше, а не разбирать «[]».
  if (input.speakers && input.speakers.length > 0) {
    form.set(INGEST_FIELD.speakers, JSON.stringify(input.speakers));
  }
  return form;
}

export class SwarmClient {
  private readonly baseUrl: string;

  private readonly doFetch: typeof globalThis.fetch;

  constructor(private readonly config: SwarmClientConfig) {
    this.baseUrl = trimTrailingSlashes(config.baseUrl);
    this.doFetch = config.fetch ?? globalThis.fetch;
  }

  private async send(spec: RequestSpec): Promise<Response> {
    const url = new URL(this.baseUrl + spec.path);
    const query = Object.entries(spec.query ?? {});
    for (const [key, value] of query) url.searchParams.set(key, value);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      // Токен агента без этого заголовка не даёт прав ни на что — так устроен сервер.
      "X-On-Behalf-Of": String(this.config.onBehalfOf),
    };
    // `Content-Type` для формы не ставим руками: границу multipart проставит fetch.
    if (spec.contentType !== undefined) headers["Content-Type"] = spec.contentType;

    let response: Response;
    try {
      response = await this.doFetch(url, {
        method: spec.method,
        headers,
        ...(spec.body && { body: spec.body() }),
        signal: AbortSignal.timeout(spec.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SwarmTransportError(`${spec.path}: ${describe(error)}`, { cause: error });
    }

    if (!response.ok) {
      let text = "";
      try {
        text = await response.text();
      } catch {
        // Тело ошибки прочитать не удалось — статус важнее текста, дальше идём с пустым.
      }
      throw new SwarmHttpError(
        response.status,
        text,
        parseRetryAfterMs(response.headers.get("Retry-After")),
      );
    }
    return response;
  }

  private async json(spec: RequestSpec): Promise<unknown> {
    const response = await withRetry(async () => this.send(spec), this.config.retry);
    const text = await response.text();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new SwarmProtocolError(`${spec.path}: ответ не JSON (${text.slice(0, 200)})`);
    }
  }

  /**
   * `GET /meeting-current` — какая встреча идёт сейчас, со ссылкой на звонок и площадкой.
   */
  async currentMeeting(): Promise<CurrentMeetingResponse> {
    const body = await this.json({ method: "GET", path: "/meeting-current" });
    return parseCurrentMeeting(body);
  }

  /**
   * `POST /meeting-claim` — застолбить транскрибацию. Ответ `defer` означает «аудио не шлём».
   */
  async claim(request: ClaimRequest): Promise<ClaimResponse> {
    const body = await this.json({
      method: "POST",
      path: "/meeting-claim",
      body: () => JSON.stringify(request),
      contentType: "application/json",
    });
    if (!isRecord(body)) throw new SwarmProtocolError("meeting-claim: ответ не объект");

    const decision = body.decision;
    // Незнакомое решение — громкий отказ. Прочитать его как «транскрибируем» значит отправить
    // аудио поверх чужого права; прочитать как «defer» — молча потерять запись встречи.
    if (decision !== "transcribe" && decision !== "defer") {
      throw new SwarmProtocolError(
        `meeting-claim: незнакомое decision ${JSON.stringify(decision)}`,
      );
    }
    const meetingId = body.meeting_id;
    if (typeof meetingId !== "string" || meetingId.length === 0) {
      throw new SwarmProtocolError("meeting-claim: в ответе нет meeting_id");
    }

    return {
      meeting_id: meetingId,
      decision,
      lease_ttl_sec: typeof body.lease_ttl_sec === "number" ? body.lease_ttl_sec : 0,
      held_by: typeof body.held_by === "number" ? body.held_by : null,
      held_by_name: typeof body.held_by_name === "string" ? body.held_by_name : null,
    };
  }

  /**
   * `POST /meeting-ingest` — выгрузка аудио. Форма ровно та же, что шлёт `bumblebee`:
   * манифест `[{name, offset}]` текстовым полем плюс файлы под именами из манифеста.
   * Новое по сравнению с рекордером ровно одно — необязательное поле `speakers`.
   */
  async ingest(input: IngestInput): Promise<IngestResponse> {
    const mic = input.mic ?? [];
    if (input.system.length === 0 && mic.length === 0) {
      throw new SwarmProtocolError("meeting-ingest: нечего отправлять — нет ни одной части");
    }

    const body = await this.json({
      method: "POST",
      path: "/meeting-ingest",
      body: () => buildIngestForm(input, mic),
      timeoutMs: this.config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
    });
    return parseIngestResponse(body);
  }

  /**
   * `POST /meeting-heartbeat` — «бот жив». Пишется в строку встречи (`meeting_id`) и агента, не человека.
   */
  async heartbeat(request: HeartbeatRequest): Promise<void> {
    await this.json({
      method: "POST",
      path: "/meeting-heartbeat",
      body: () => JSON.stringify(request),
      contentType: "application/json",
    });
  }

  /**
   * `GET /meeting-status?ids=…` — статусы своих встреч. По ним очередь понимает, что запись
   * доехала до базы и локальный бэкап можно отпустить.
   */
  async statuses(ids: readonly string[]): Promise<Map<string, MeetingStatusItem>> {
    const wanted = ids.filter((id) => id.length > 0);
    if (wanted.length === 0) return new Map();

    const body = await this.json({
      method: "GET",
      path: "/meeting-status",
      query: { ids: wanted.join(",") },
    });
    if (!isRecord(body)) throw new SwarmProtocolError("meeting-status: ответ не объект");

    const statuses: unknown = body.statuses;
    if (!Array.isArray(statuses)) {
      throw new SwarmProtocolError("meeting-status: нет списка statuses");
    }

    const items = (statuses as readonly unknown[]).filter(isStatusItem);
    return new Map(items.map((item) => [item.id, item]));
  }
}
