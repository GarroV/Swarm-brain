/**
 * Клиент `POST /meeting-calendar` (T100): сервер читает календари людей воркспейса, включивших
 * автозапуск, заводит задания на ближайшие встречи Meet и отдаёт оркестратору ещё не забранные —
 * каждое один раз. Всё, на что бот не пойдёт, приходит в `skipped` с причиной.
 *
 * Дверь та же, что у `meeting-invite`: только токен агента, без `X-On-Behalf-Of`. Повторов нет
 * намеренно — забранное задание повтор не вернёт, а следующий опрос придёт через минуту.
 *
 * Имена полей — snake_case, как на проводе; сверку с сервером держит `calendar-client.test.ts`
 * (читает `supabase/functions/meeting-calendar/index.ts`).
 */
import {
  parseRetryAfterMs,
  SwarmHttpError,
  SwarmProtocolError,
  SwarmTransportError,
} from "../swarm-client/errors.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const PATH = "/meeting-calendar";

/**
 * Задание боту: встреча из календаря `invited_by`, бот идёт за него.
 */
export interface CalendarJob {
  readonly id: string;
  readonly calendar_key: string;
  readonly invited_by: number;
  readonly join_url: string;
  readonly platform: string;
  readonly title: string | null;
  readonly starts_at: string;
  readonly ends_at: string;
  /**
   * Пропуск бота на эту встречу (T165); сервер без пропусков его не присылает.
   */
  readonly grant_token?: string;
}

/**
 * Встреча (или целый календарь человека — тогда `calendar_key` пуст), на которую бот не пойдёт.
 */
export interface CalendarSkip {
  readonly invited_by: number;
  readonly calendar_key: string | null;
  readonly title: string | null;
  readonly reason: string;
  readonly platform?: string | null;
}

export interface CalendarSweep {
  readonly jobs: readonly CalendarJob[];
  readonly skipped: readonly CalendarSkip[];
  /**
   * Задания, забранные на сервере, но не прошедшие разбор, — с причиной, чтобы сказать громко.
   */
  readonly malformed: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPerson(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function jobProblem(item: Record<string, unknown>): string | null {
  if (!isFilledString(item.id)) return "нет id";
  if (!isFilledString(item.calendar_key)) return "нет calendar_key";
  if (!isPerson(item.invited_by)) {
    return `invited_by не telegram id: ${JSON.stringify(item.invited_by ?? null)}`;
  }
  if (typeof item.join_url !== "string" || !item.join_url.startsWith("https://")) {
    return "join_url не https-ссылка";
  }
  if (!isFilledString(item.platform)) return "нет platform";
  if (!isFilledString(item.starts_at) || Number.isNaN(Date.parse(item.starts_at))) {
    return "starts_at не время";
  }
  if (!isFilledString(item.ends_at) || Number.isNaN(Date.parse(item.ends_at))) {
    return "ends_at не время";
  }
  if (item.title !== null && typeof item.title !== "string") return "title не строка";
  // Пропуск необязателен (сервер до T165 его не шлёт), но присланный обязан быть строкой.
  if (item.grant_token !== undefined && !isFilledString(item.grant_token))
    return "grant_token не строка";
  return null;
}

function parseJobs(raw: unknown[]): { jobs: CalendarJob[]; malformed: string[] } {
  const jobs: CalendarJob[] = [];
  const malformed: string[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      malformed.push(`jobs[${String(index)}]: не объект`);
      continue;
    }
    const problem = jobProblem(item);
    if (problem === null) {
      jobs.push(item as unknown as CalendarJob);
      continue;
    }
    const id = isFilledString(item.id) ? ` (${item.id})` : "";
    malformed.push(`jobs[${String(index)}]${id}: ${problem}`);
  }
  return { jobs, malformed };
}

function parseSkipped(raw: unknown[]): CalendarSkip[] {
  // Пропуск — только сведения для журнала: кривой пропуск не повод терять остальные.
  return raw.filter(
    (item): item is CalendarSkip =>
      isRecord(item) && isPerson(item.invited_by) && isFilledString(item.reason),
  );
}

/**
 * Разбор ответа `meeting-calendar`. Не та форма ответа целиком — `SwarmProtocolError`.
 */
export function parseCalendarSweep(body: unknown): CalendarSweep {
  if (!isRecord(body) || body.ok !== true) {
    throw new SwarmProtocolError("meeting-calendar: ответ не { ok: true, … }");
  }
  if (!Array.isArray(body.jobs)) throw new SwarmProtocolError("meeting-calendar: нет списка jobs");
  if (!Array.isArray(body.skipped)) {
    throw new SwarmProtocolError("meeting-calendar: нет списка skipped");
  }
  const { jobs, malformed } = parseJobs(body.jobs as unknown[]);
  return { jobs, skipped: parseSkipped(body.skipped as unknown[]), malformed };
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

export interface CalendarClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class CalendarClient {
  private readonly url: string;

  private readonly doFetch: typeof globalThis.fetch;

  private readonly config: CalendarClientConfig;

  constructor(config: CalendarClientConfig) {
    this.config = config;
    this.url = withoutTrailingSlashes(config.baseUrl) + PATH;
    this.doFetch = config.fetch ?? globalThis.fetch;
  }

  /**
   * Один проход по календарям воркспейса. Забранное другим уже не вернётся.
   */
  async sweep(): Promise<CalendarSweep> {
    let response: Response;
    try {
      response = await this.doFetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.token}` },
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
    return parseCalendarSweep(body);
  }
}
