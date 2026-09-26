/**
 * Клиент `POST /meeting-invite` — откуда оркестратор узнаёт, что человек позвал бота (D017).
 *
 * Отдельно от `SwarmClient`, потому что личность здесь другая: `SwarmClient` всегда говорит от
 * имени человека (`X-On-Behalf-Of`), а дверь `meeting-invite` пускает только сам токен агента и
 * подмену отвергает 403 — приглашения воркспейса забирает служба, а не человек.
 *
 * Повторов нет намеренно. Сервер отдаёт каждое приглашение ровно один раз: ответ, потерянный
 * после забора, повтор не вернёт, а следующий опрос оркестратора и так придёт через несколько
 * секунд. Сбой запроса — исключение, решение о нём принимает опрашивающий.
 */
import type { MeetingInvite } from "./contract.ts";
import {
  parseRetryAfterMs,
  SwarmHttpError,
  SwarmProtocolError,
  SwarmTransportError,
} from "./errors.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const PATH = "/meeting-invite";

export interface InviteClientConfig {
  /**
   * Корень функций, например `https://<project>.supabase.co/functions/v1`.
   */
  readonly baseUrl: string;
  /**
   * Токен служебного агента.
   */
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Что забрано одним опросом. Кривое приглашение не роняет пачку: оно уже забрано на сервере, и
 * исключение потеряло бы вместе с ним все соседние. Оно откладывается с причиной — громко.
 */
export interface TakenInvites {
  readonly invites: readonly MeetingInvite[];
  readonly malformed: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function inviteProblem(item: Record<string, unknown>): string | null {
  if (!isFilledString(item.id)) return "нет id";
  const invitedBy = item.invited_by;
  if (typeof invitedBy !== "number" || !Number.isSafeInteger(invitedBy) || invitedBy <= 0) {
    return `invited_by не telegram id: ${JSON.stringify(invitedBy ?? null)}`;
  }
  if (typeof item.join_url !== "string" || !item.join_url.startsWith("https://")) {
    return "join_url не https-ссылка";
  }
  if (!isFilledString(item.platform)) return "нет platform";
  if (!isFilledString(item.created_at)) return "нет created_at";
  if (!isFilledString(item.expires_at)) return "нет expires_at";
  return null;
}

/**
 * Разбор ответа `meeting-invite`. Не та форма ответа целиком — `SwarmProtocolError`.
 */
export function parseTakenInvites(body: unknown): TakenInvites {
  if (!isRecord(body) || body.ok !== true) {
    throw new SwarmProtocolError("meeting-invite: ответ не { ok: true, … }");
  }
  const raw = body.invites;
  if (!Array.isArray(raw)) throw new SwarmProtocolError("meeting-invite: нет списка invites");

  const invites: MeetingInvite[] = [];
  const malformed: string[] = [];
  for (const [index, item] of (raw as unknown[]).entries()) {
    if (!isRecord(item)) {
      malformed.push(`invites[${String(index)}]: не объект`);
      continue;
    }
    const problem = inviteProblem(item);
    if (problem === null) {
      invites.push(item as unknown as MeetingInvite);
      continue;
    }
    const id = typeof item.id === "string" && item.id !== "" ? ` (${item.id})` : "";
    malformed.push(`invites[${String(index)}]${id}: ${problem}`);
  }
  return { invites, malformed };
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

export class InviteClient {
  private readonly url: string;

  private readonly doFetch: typeof globalThis.fetch;

  constructor(private readonly config: InviteClientConfig) {
    this.url = withoutTrailingSlashes(config.baseUrl) + PATH;
    this.doFetch = config.fetch ?? globalThis.fetch;
  }

  /**
   * Забрать ожидающие приглашения своего воркспейса. Забранное другим уже не вернётся.
   */
  async take(limit?: number): Promise<TakenInvites> {
    let response: Response;
    try {
      response = await this.doFetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        ...(limit !== undefined && { body: JSON.stringify({ limit }) }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SwarmTransportError(`${PATH}: ${reason}`, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new SwarmHttpError(
        response.status,
        text,
        parseRetryAfterMs(response.headers.get("Retry-After")),
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SwarmProtocolError(`${PATH}: ответ не JSON (${text.slice(0, 200)})`);
    }
    return parseTakenInvites(body);
  }
}
