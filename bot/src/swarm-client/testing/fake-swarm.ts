/**
 * Фальшивый сервер Swarm для тестов `swarm-client`: настоящий HTTP-сервер на `node:http`,
 * поднимаемый в процессе теста и повторяющий контракт пяти эндпоинтов настоящего сервера —
 * ровно тот, что живёт в `contract.ts`. Против него живой клиент ходит по реальной сети на
 * localhost, а не через мок `fetch`: так тест ловит расхождения в заголовках, кодировке формы
 * и статусах, которые мок бы просто не заметил.
 *
 * Правила приёмки списаны с серверного кода (а не придуманы):
 *  - `supabase/functions/meeting-ingest/index.ts` — `buildTrackParts` и обработчик;
 *  - `supabase/functions/meeting-claim/index.ts` — `ClaimBody` и ответ;
 *  - `supabase/functions/meeting-status/index.ts`, `meeting-heartbeat/index.ts` — целиком;
 *  - `supabase/functions/meeting-current/index.ts` — форма ответа;
 *  - `supabase/functions/_shared/agent-auth.ts` — `resolveActingIdentity` (общая авторизация);
 *  - `supabase/functions/meeting-invite/index.ts` + `_shared/meeting-invite.ts` — приглашения
 *    бота (решение D017): забор ровно один раз и сверка приглашения в `meeting-claim`.
 *
 * Двойник — оракул для всего блока `swarm-client`, поэтому каждое правило приёмки должно падать
 * на сломанном входе: это проверяется тестами в `fake-swarm.test.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  INGEST_FIELD,
  INGEST_PART_MAX_BYTES,
  type ClaimDecision,
  type CurrentMeetingResponse,
  type MeetingStatusItem,
  type SpeakerSpan,
} from "../contract.ts";

const DEFAULT_TOKEN = "test-bot-token";
const DEFAULT_ON_BEHALF_OF = 744_230_399;
const DEFAULT_LEASE_TTL_SEC = 3600;
const OTHER_HOLDER_ID = 111_111;
const OTHER_HOLDER_NAME = "other";
const ON_BEHALF_OF_HEADER = "x-on-behalf-of";
const INVITE_DEFAULT_LIMIT = 10;
const INVITE_MAX_LIMIT = 20;
const INVITE_TTL_MS = 15 * 60_000;

/**
Комната по ссылке — как `parseInviteLink` на сервере: хост и путь без хвостовых слэшей,
в нижнем регистре; query и якорь не в счёт.
*/
function inviteRoom(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    let path = url.pathname;
    while (path.endsWith("/")) path = path.slice(0, -1);
    return `${url.hostname}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

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
}

/**
Приглашение бота в двойнике — те же поля, что отдаёт `POST /meeting-invite`.
*/
interface FakeInvite {
  readonly id: string;
  readonly invited_by: number;
  readonly join_url: string;
  readonly platform: string;
  readonly created_at: string;
  readonly expires_at: string;
}

interface InviteRecord {
  readonly invite: FakeInvite;
  taken: boolean;
  used: boolean;
}

interface RecordedRequest {
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
interface IngestPart {
  readonly name: string;
  readonly offset: number;
  readonly bytes: number;
  readonly content: string;
}

/**
Что сервер увидел в multipart-форме meeting-ingest.
*/
interface IngestRecord {
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
  Забрано ли приглашение оркестратором и погашено ли заявкой бота. Неизвестный id — ошибка.
  */
  inviteState(id: string): { taken: boolean; used: boolean };
  /**
  Закрыть сервер и дождаться закрытия. Идемпотентно.
  */
  close(): Promise<void>;
}

/**
Узкий взгляд на unknown-значение как на объект — для безопасного чтения полей JSON без `any`.
*/
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
JSON тела запроса. Невалидный JSON или пустое тело — как на heartbeat-эндпоинте сервера: `{}`.
*/
function parseJsonBody(rawBody: Buffer): unknown {
  if (rawBody.length === 0) return {};
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return {};
  }
}

function queryToRecord(url: URL): Record<string, string> {
  const query: Record<string, string> = Object.fromEntries(url.searchParams);
  return query;
}

function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", (error: Error) => {
      reject(error);
    });
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    // Без этого сокет держится keep-alive, и server.close() в afterEach зависает до таймаута теста.
    Connection: "close",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

interface AuthFailure {
  readonly status: 401 | 403;
  readonly body: { readonly error: string };
}

/**
Общая для всех пяти эндпоинтов проверка — как `resolveActingIdentity` на сервере.
*/
function checkAuth(
  authorization: string | null,
  onBehalfOfHeader: string | null,
  token: string,
  onBehalfOfId: number,
): AuthFailure | null {
  if (authorization !== `Bearer ${token}`) {
    return { status: 401, body: { error: "bad token" } };
  }
  if (onBehalfOfHeader === null) {
    return {
      status: 403,
      body: { error: "service agent token grants nothing on its own — send X-On-Behalf-Of" },
    };
  }
  if (Number(onBehalfOfHeader) !== onBehalfOfId) {
    return { status: 403, body: { error: "user not in agent workspace" } };
  }
  return null;
}

/**
Ошибка разбора манифеста части — с HTTP-статусом (413 для превышения лимита, 400 для прочего).
*/
class IngestValidationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
Манифест — JSON-строка с массивом `{name, offset}`. Разбор вынесен отдельно от разбора частей.
*/
function parseManifestJson(raw: string, manifestField: string): unknown[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new IngestValidationError(`${manifestField}: invalid JSON manifest`);
  }
  if (!Array.isArray(manifest)) {
    throw new IngestValidationError(`${manifestField}: manifest must be an array`);
  }
  return manifest;
}

/**
Один элемент манифеста → файл из формы. Вынесено из `buildTrackParts`, чтобы не раздувать её сложность.
*/
async function resolveManifestPart(
  formData: FormData,
  manifestField: string,
  item: unknown,
  seen: Set<string>,
): Promise<IngestPart> {
  const entry = isRecord(item) ? item : {};
  const name = typeof entry.name === "string" ? entry.name : "";
  if (!name) throw new IngestValidationError(`${manifestField}: part name required`);
  if (seen.has(name))
    throw new IngestValidationError(`${manifestField}: duplicate part name "${name}"`);
  seen.add(name);

  const offset = Number(entry.offset);
  if (!Number.isFinite(offset) || offset < 0) {
    throw new IngestValidationError(`${manifestField}: bad offset for "${name}"`);
  }

  const file = formData.get(name);
  if (!(file instanceof File)) {
    throw new IngestValidationError(`${manifestField}: file "${name}" missing`);
  }
  if (file.size === 0) {
    throw new IngestValidationError(`${manifestField}: file "${name}" empty`);
  }
  if (file.size > INGEST_PART_MAX_BYTES) {
    throw new IngestValidationError(`part "${name}" too large (>25MB)`, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return { name, offset, bytes: buffer.byteLength, content: buffer.toString("utf8") };
}

/**
Собирает одну дорожку (`sys_parts`/`mic_parts`) по манифесту — правила ровно как в `buildTrackParts` сервера.
*/
async function buildTrackParts(formData: FormData, manifestField: string): Promise<IngestPart[]> {
  const raw = formData.get(manifestField);
  if (typeof raw !== "string" || raw.length === 0) return [];

  const manifest = parseManifestJson(raw, manifestField);
  const seen = new Set<string>();
  const parts: IngestPart[] = [];
  for (const item of manifest) {
    parts.push(await resolveManifestPart(formData, manifestField, item, seen));
  }
  return parts;
}

/**
Необязательное поле `speakers`: отсутствие — норма, невалидный JSON-массив — ошибка.
*/
function parseSpeakers(formData: FormData): { speakers?: readonly SpeakerSpan[] } {
  const raw = formData.get(INGEST_FIELD.speakers);
  if (typeof raw !== "string" || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IngestValidationError("speakers: invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new IngestValidationError("speakers: invalid JSON");
  }
  return { speakers: parsed as SpeakerSpan[] };
}

function defaultCurrentResponse(): CurrentMeetingResponse {
  const now = Date.now();
  return {
    meeting: {
      identity_kind: "calendar",
      identity_key: "evt-1:2026-09-23",
      title: "Тестовая встреча",
      attendees: [],
      started_at: new Date(now - 15 * 60_000).toISOString(),
      ended_at: new Date(now + 15 * 60_000).toISOString(),
      join_url: "https://meet.google.com/abc-defg-hij",
      platform: "meet",
    },
  };
}

interface RouteResult {
  readonly status: number;
  readonly responseBody: unknown;
  /**
  Что положить в `RecordedRequest.body`.
  */
  readonly requestBody: unknown;
  readonly headers?: Record<string, string>;
}

interface PendingFailure {
  readonly remaining: number;
  readonly status: number;
  readonly retryAfterSeconds?: number;
}

class FakeSwarmServer implements FakeSwarm {
  private readonly server = createServer((request, response) => {
    // Явный void: обработчик самостоятельно ловит и превращает в 500 всё, что уронило бы процесс.
    void this.handleRequestSafely(request, response);
  });

  private readonly recordedRequests: RecordedRequest[] = [];
  private readonly ingestedRecords: IngestRecord[] = [];
  private readonly statuses = new Map<
    string,
    { summary_status: string | null; status: string | null }
  >();

  private readonly token: string;
  private readonly onBehalfOfId: number;
  private readonly current: CurrentMeetingResponse;
  private readonly requiresInvites: boolean;
  private readonly invites = new Map<string, InviteRecord>();
  private inviteSeq = 0;
  private decision: ClaimDecision;
  private pendingFailure: PendingFailure | null = null;
  private actualPort = 0;
  private closed = false;

  constructor(options: FakeSwarmOptions) {
    this.token = options.token ?? DEFAULT_TOKEN;
    this.onBehalfOfId = options.onBehalfOf ?? DEFAULT_ON_BEHALF_OF;
    this.decision = options.decision ?? "transcribe";
    this.current = options.current ?? defaultCurrentResponse();
    this.requiresInvites = options.requiresInvites ?? false;
  }

  private async handleRequestSafely(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      await this.handleRequest(request, response);
    } catch (error) {
      console.error("fake-swarm: unhandled request error", error);
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: "fake-swarm internal error" });
      }
    }
  }

  private consumeInjectedFailure(): { status: number; headers?: Record<string, string> } | null {
    const pending = this.pendingFailure;
    if (!pending || pending.remaining <= 0) return null;
    const remaining = pending.remaining - 1;
    this.pendingFailure = remaining > 0 ? { ...pending, remaining } : null;
    return {
      status: pending.status,
      ...(pending.retryAfterSeconds !== undefined && {
        headers: { "Retry-After": String(pending.retryAfterSeconds) },
      }),
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawBody = await readRawBody(request);
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const path = url.pathname;
    const query = queryToRecord(url);
    const authorization = headerValue(request.headers.authorization);
    const onBehalfOf = headerValue(request.headers[ON_BEHALF_OF_HEADER]);

    const finish = (
      status: number,
      responseBody: unknown,
      requestBody: unknown,
      headers?: Record<string, string>,
    ): void => {
      sendJson(response, status, responseBody, headers);
      this.recordedRequests.push({
        method,
        path,
        query,
        authorization,
        onBehalfOf,
        body: requestBody,
        status,
      });
    };

    const injected = this.consumeInjectedFailure();
    if (injected) {
      finish(injected.status, { ok: false, error: "injected" }, null, injected.headers);
      return;
    }

    // Дверь `meeting-invite` — resolveServiceAgent: только токен, подмена личности — 403.
    if (path === "/meeting-invite") {
      const result = this.handleInviteTake(method, authorization, onBehalfOf, rawBody);
      finish(result.status, result.responseBody, result.requestBody);
      return;
    }

    const authFailure = checkAuth(authorization, onBehalfOf, this.token, this.onBehalfOfId);
    if (authFailure) {
      finish(authFailure.status, authFailure.body, null);
      return;
    }

    const contentType = headerValue(request.headers["content-type"]);
    const result = await this.route(method, path, url, rawBody, contentType);
    finish(result.status, result.responseBody, result.requestBody, result.headers);
  }

  private async route(
    method: string,
    path: string,
    url: URL,
    rawBody: Buffer,
    contentType: string | null,
  ): Promise<RouteResult> {
    if (method === "GET" && path === "/meeting-current") {
      return { status: 200, responseBody: this.current, requestBody: null };
    }
    if (method === "POST" && path === "/meeting-claim") {
      return this.handleClaim(rawBody);
    }
    if (method === "POST" && path === "/meeting-ingest") {
      return this.handleIngest(rawBody, contentType);
    }
    if (method === "POST" && path === "/meeting-heartbeat") {
      return this.handleHeartbeat(rawBody);
    }
    if (method === "GET" && path === "/meeting-status") {
      return this.handleStatus(url);
    }
    return { status: 404, responseBody: { ok: false, error: "not found" }, requestBody: null };
  }

  private handleClaim(rawBody: Buffer): RouteResult {
    const parsed = parseJsonBody(rawBody);
    const identityKind = isRecord(parsed) ? parsed.identity_kind : undefined;
    const identityKey = isRecord(parsed) ? parsed.identity_key : undefined;
    // Раздельные проверки на каждое поле: length читается только после того, как typeof это разрешил.
    if (typeof identityKind !== "string" || identityKind.length === 0) {
      return {
        status: 400,
        responseBody: { ok: false, error: "identity_kind/identity_key required" },
        requestBody: parsed,
      };
    }
    if (typeof identityKey !== "string" || identityKey.length === 0) {
      return {
        status: 400,
        responseBody: { ok: false, error: "identity_kind/identity_key required" },
        requestBody: parsed,
      };
    }

    const inviteRefusal = this.checkClaimInvite(parsed, identityKind);
    if (inviteRefusal) return inviteRefusal;

    const meetingId = `m-${identityKey}`;
    const heldBy = this.decision === "defer" ? OTHER_HOLDER_ID : null;
    const heldByName = this.decision === "defer" ? OTHER_HOLDER_NAME : null;
    return {
      status: 200,
      responseBody: {
        meeting_id: meetingId,
        decision: this.decision,
        lease_ttl_sec: DEFAULT_LEASE_TTL_SEC,
        held_by: heldBy,
        held_by_name: heldByName,
      },
      requestBody: parsed,
    };
  }

  private handleInviteTake(
    method: string,
    authorization: string | null,
    onBehalfOf: string | null,
    rawBody: Buffer,
  ): RouteResult {
    const parsed = parseJsonBody(rawBody);
    const refuse = (status: number, error: string): RouteResult => ({
      status,
      responseBody: { ok: false, error },
      requestBody: parsed,
    });
    if (method !== "POST") return refuse(405, "method not allowed");
    if (authorization !== `Bearer ${this.token}`) return refuse(401, "bad token");
    if (onBehalfOf !== null) return refuse(403, "X-On-Behalf-Of is not accepted by this endpoint");

    const raw = isRecord(parsed) ? parsed.limit : undefined;
    if (raw !== undefined && (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1)) {
      return refuse(400, "limit must be a positive integer");
    }
    const limit = Math.min(raw ?? INVITE_DEFAULT_LIMIT, INVITE_MAX_LIMIT);
    const now = Date.now();
    // Map хранит порядок вставки — это и есть «старые первыми». Забор синхронный, поэтому два
    // одновременных опроса одну запись не делят — как условный UPDATE на сервере.
    const pending: InviteRecord[] = [];
    for (const record of this.invites.values()) {
      const isOpen = !record.taken && !record.used;
      if (isOpen && Date.parse(record.invite.expires_at) > now) pending.push(record);
    }
    pending.splice(limit);
    for (const record of pending) record.taken = true;
    return {
      status: 200,
      responseBody: { ok: true, invites: pending.map((record) => record.invite) },
      requestBody: parsed,
    };
  }

  /**
  Сверка приглашения в заявке — как `checkInviteForClaim`: предъявленное приглашение сверяется
  всегда; строгий двойник, кроме того, не пускает ручную заявку без приглашения.
  */
  private checkClaimInvite(parsed: unknown, identityKind: string): RouteResult | null {
    const inviteId = isRecord(parsed) ? parsed.invite_id : undefined;
    const isDemanded = this.requiresInvites && identityKind === "manual";
    if (!isDemanded && inviteId === undefined) return null;
    const refusal = this.inviteRefusal(inviteId, isRecord(parsed) ? parsed.join_url : undefined);
    if (refusal === null) return null;
    return {
      status: 403,
      responseBody: {
        ok: false,
        error: `service agent: a manual meeting needs a valid invite — the person pastes the call link in Swarm (${refusal})`,
      },
      requestBody: parsed,
    };
  }

  private inviteRefusal(inviteId: unknown, joinUrl: unknown): string | null {
    const record = typeof inviteId === "string" ? this.invites.get(inviteId) : undefined;
    if (record === undefined) return "not_found";
    if (record.invite.invited_by !== this.onBehalfOfId) return "other_person";
    if (record.used) return "used";
    if (Date.parse(record.invite.expires_at) <= Date.now()) return "expired";
    const room = inviteRoom(joinUrl);
    if (room === null || room !== inviteRoom(record.invite.join_url)) return "link_mismatch";
    record.used = true;
    record.taken = false;
    return null;
  }

  private async handleIngest(rawBody: Buffer, contentType: string | null): Promise<RouteResult> {
    let formData: FormData;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        body: rawBody,
        ...(contentType !== null && { headers: { "content-type": contentType } }),
      };
      // formData() помечен deprecated для непроверенных серверов (просит стриминговый парсер); здесь
      // источник — собственный тестовый Buffer на localhost, не чужой трафик — буферизация безопасна.
      // eslint-disable-next-line @typescript-eslint/no-deprecated, sonarjs/deprecation
      formData = await new Request("http://localhost/meeting-ingest", requestInit).formData();
    } catch {
      return {
        status: 400,
        responseBody: { ok: false, error: "expected multipart/form-data with meeting_id + audio" },
        requestBody: null,
      };
    }

    const meetingIdRaw = formData.get(INGEST_FIELD.meetingId);
    const meetingId = typeof meetingIdRaw === "string" ? meetingIdRaw : "";
    if (meetingId.length === 0) {
      return {
        status: 400,
        responseBody: { ok: false, error: "meeting_id required" },
        requestBody: null,
      };
    }

    let sys: IngestPart[];
    let mic: IngestPart[];
    let speakersResult: { speakers?: readonly SpeakerSpan[] };
    try {
      sys = await buildTrackParts(formData, INGEST_FIELD.systemManifest);
      mic = await buildTrackParts(formData, INGEST_FIELD.micManifest);
      speakersResult = parseSpeakers(formData);
    } catch (error) {
      // Инвариант: buildTrackParts/resolveManifestPart/parseSpeakers не читают сеть и не делают I/O
      // (formData уже полностью разобран и буферизован строкой выше) — единственное, что они могут
      // бросить, это IngestValidationError. Проверка instanceof + повторный throw здесь была бы
      // веткой, недостижимой ни при каком реальном HTTP-входе, — оставлять её не смысла.
      const validationError = error as IngestValidationError;
      return {
        status: validationError.status,
        responseBody: { ok: false, error: validationError.message },
        requestBody: null,
      };
    }

    if (sys.length === 0 && mic.length === 0) {
      return {
        status: 400,
        responseBody: {
          ok: false,
          error: "audio required (sys_parts/mic_parts manifest or legacy audio field)",
        },
        requestBody: null,
      };
    }

    const record: IngestRecord = { meeting_id: meetingId, sys, mic, ...speakersResult };
    this.ingestedRecords.push(record);

    return {
      status: 202,
      responseBody: {
        ok: true,
        meeting_id: meetingId,
        web_url: `https://swarm.example/?meeting=${meetingId}`,
        summary_status: "processing",
      },
      requestBody: record,
    };
  }

  private handleHeartbeat(rawBody: Buffer): RouteResult {
    const parsed = parseJsonBody(rawBody);
    return { status: 200, responseBody: { ok: true }, requestBody: parsed };
  }

  private handleStatus(url: URL): RouteResult {
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const statuses: MeetingStatusItem[] = [];
    for (const id of ids) {
      const value = this.statuses.get(id);
      if (value) statuses.push({ id, summary_status: value.summary_status, status: value.status });
    }
    return { status: 200, responseBody: { ok: true, statuses }, requestBody: null };
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        // Слушаем всегда на числовом TCP-порту (не на unix-сокете), поэтому address() — всегда
        // AddressInfo; null/string здесь недостижимы, и ветка под них не тестируема реальным входом.
        this.actualPort = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${String(this.actualPort)}`;
  }

  get port(): number {
    return this.actualPort;
  }

  get requests(): readonly RecordedRequest[] {
    return [...this.recordedRequests];
  }

  get ingested(): readonly IngestRecord[] {
    return [...this.ingestedRecords];
  }

  requestsTo(path: string): readonly RecordedRequest[] {
    return this.recordedRequests.filter((entry) => entry.path === path);
  }

  failNext(count: number, status: number, options?: { retryAfterSeconds?: number }): void {
    this.pendingFailure = {
      remaining: count,
      status,
      ...(options?.retryAfterSeconds !== undefined && {
        retryAfterSeconds: options.retryAfterSeconds,
      }),
    };
  }

  setDecision(decision: ClaimDecision): void {
    this.decision = decision;
  }

  setStatus(id: string, value: { summary_status?: string | null; status?: string | null }): void {
    const existing = this.statuses.get(id) ?? { summary_status: null, status: null };
    this.statuses.set(id, {
      summary_status:
        value.summary_status === undefined ? existing.summary_status : value.summary_status,
      status: value.status === undefined ? existing.status : value.status,
    });
  }

  addInvite(input: {
    joinUrl: string;
    platform?: string;
    invitedBy?: number;
    expiresInMs?: number;
  }): FakeInvite {
    this.inviteSeq += 1;
    // Время создания растёт строго: порядок «старые первыми» не зависит от разрешения часов.
    const createdMs = Date.now() + this.inviteSeq;
    const invite: FakeInvite = {
      id: `invite-${String(this.inviteSeq)}`,
      invited_by: input.invitedBy ?? this.onBehalfOfId,
      join_url: input.joinUrl,
      platform: input.platform ?? "meet",
      created_at: new Date(createdMs).toISOString(),
      expires_at: new Date(createdMs + (input.expiresInMs ?? INVITE_TTL_MS)).toISOString(),
    };
    this.invites.set(invite.id, { invite, taken: false, used: false });
    return invite;
  }

  inviteState(id: string): { taken: boolean; used: boolean } {
    const record = this.invites.get(id);
    if (record === undefined) throw new Error(`fake-swarm: приглашения ${id} нет`);
    return { taken: record.taken, used: record.used };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

/**
Поднимает фальшивый сервер Swarm на localhost. Порт по умолчанию — эфемерный (ОС выберет сама).
*/
export async function startFakeSwarm(options: FakeSwarmOptions = {}): Promise<FakeSwarm> {
  const server = new FakeSwarmServer(options);
  await server.listen(options.port ?? 0);
  return server;
}
