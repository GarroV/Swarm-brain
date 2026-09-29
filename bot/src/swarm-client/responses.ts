/**
 * Проверка формы ответов `meeting-current` и `meeting-ingest` на границе.
 *
 * Тот же принцип, что у `claim()` и `statuses()` в `client.ts`: всё, чем бот потом
 * распоряжается, проверяется здесь, а не приводится типом на веру. Переименуй сервер
 * `join_url` — без этой проверки оркестратор получил бы `undefined` и не вошёл в звонок
 * без единой внятной ошибки. С ней — громкий `SwarmProtocolError` с именем поля.
 */
import type {
  Attendee,
  ConferencePlatform,
  CurrentMeeting,
  CurrentMeetingResponse,
  IngestResponse,
} from "./contract.ts";
import { SwarmProtocolError } from "./errors.ts";

const PLATFORMS: readonly ConferencePlatform[] = ["meet", "kontur", "zoom"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(endpoint: string, what: string): never {
  throw new SwarmProtocolError(`${endpoint}: ${what}`);
}

function requireText(endpoint: string, body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(endpoint, `нет поля ${key} (получено ${JSON.stringify(value)})`);
  }
  return value;
}

function nullableText(endpoint: string, body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === null || typeof value === "string") return value;
  return fail(endpoint, `поле ${key} не строка и не null (получено ${JSON.stringify(value)})`);
}

function parsePlatform(value: unknown): ConferencePlatform | null {
  if (value === null) return null;
  const known = PLATFORMS.find((platform) => platform === value);
  if (known === undefined) {
    fail("meeting-current", `незнакомая платформа ${JSON.stringify(value)}`);
  }
  return known;
}

function parseAttendees(value: unknown): readonly Attendee[] {
  if (!Array.isArray(value)) fail("meeting-current", "attendees не список");
  return (value as readonly unknown[]).map((item) => {
    if (!isRecord(item)) fail("meeting-current", "участник в attendees не объект");
    return {
      name: typeof item.name === "string" ? item.name : null,
      email: typeof item.email === "string" ? item.email : null,
    };
  });
}

function parseMeeting(raw: Record<string, unknown>): CurrentMeeting {
  const endpoint = "meeting-current";
  // `join_url` обязан присутствовать ключом: `null` — это ответ «ссылки нет», а отсутствие
  // ключа — сервер заговорил на другом языке.
  if (!("join_url" in raw)) fail(endpoint, "нет поля join_url");
  const joinUrl = nullableText(endpoint, raw, "join_url");
  const platform = parsePlatform(raw.platform ?? null);
  if (joinUrl === null && platform !== null) {
    fail(endpoint, `противоречие: ссылки нет, а площадка ${platform}`);
  }
  const reason = raw.reason;
  if (reason !== undefined && reason !== "no_conference_link") {
    fail(endpoint, `незнакомая причина ${JSON.stringify(reason)}`);
  }
  return {
    identity_kind: requireText(endpoint, raw, "identity_kind"),
    identity_key: requireText(endpoint, raw, "identity_key"),
    title: raw.title === undefined ? null : nullableText(endpoint, raw, "title"),
    attendees: parseAttendees(raw.attendees),
    started_at: requireText(endpoint, raw, "started_at"),
    ended_at: requireText(endpoint, raw, "ended_at"),
    join_url: joinUrl,
    platform,
    ...(reason !== undefined && { reason }),
  };
}

/**
 * Ответ `meeting-current`: `{ meeting: {...} | null, reason?: string }`.
 */
export function parseCurrentMeeting(body: unknown): CurrentMeetingResponse {
  const endpoint = "meeting-current";
  if (!isRecord(body)) fail(endpoint, "ответ не объект");
  if (!("meeting" in body)) fail(endpoint, "нет поля meeting");
  const reason = body.reason;
  if (reason !== undefined && typeof reason !== "string") {
    fail(endpoint, `reason не строка (получено ${JSON.stringify(reason)})`);
  }
  const reasonPart = reason === undefined ? {} : { reason };
  if (body.meeting === null) return { meeting: null, ...reasonPart };
  if (!isRecord(body.meeting)) fail(endpoint, "meeting не объект и не null");
  return { meeting: parseMeeting(body.meeting), ...reasonPart };
}

/**
 * Ответ `meeting-ingest`: `{ ok: true, meeting_id, web_url, summary_status }`.
 * Пустой `web_url` законен: сервер без `WEB_BASE_URL` отвечает именно так.
 */
export function parseIngestResponse(body: unknown): IngestResponse {
  const endpoint = "meeting-ingest";
  if (!isRecord(body)) fail(endpoint, "ответ не объект");
  if (body.ok !== true) fail(endpoint, `ok не true (получено ${JSON.stringify(body.ok)})`);
  const webUrl = body.web_url;
  if (typeof webUrl !== "string") {
    fail(endpoint, `web_url не строка (получено ${JSON.stringify(webUrl)})`);
  }
  return {
    ok: true,
    meeting_id: requireText(endpoint, body, "meeting_id"),
    web_url: webUrl,
    summary_status: requireText(endpoint, body, "summary_status"),
  };
}
