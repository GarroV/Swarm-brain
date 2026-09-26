// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// До какой границы служебный агент действует за человека (решение D016, issue #371).
//
// resolveActingIdentity уже сверил, что человек — из воркспейса агента. Этого мало: граница по
// воркспейсу позволяет скомпрометированному или ошибившемуся токену завести приватную запись
// человеку, которого на звонке не было. Здесь граница сужается до СОСТАВА ВСТРЕЧИ — там, где
// состав известен:
//
//   • календарная встреча — сервер сам смотрит календарь названного человека: событие с этим
//     ключом обязано там быть. Состав из тела запроса не берётся — его прислал тот же агент,
//     и скомпрометированный токен подставил бы туда кого угодно;
//   • присоединение к уже открытой встрече (тот же ключ или склейка по составу) — человек обязан
//     быть в её составе или уже держать её;
//   • ручная и комнатная встречи — без сверки: состава у них нет по определению, а ручной путь
//     решением D015 объявлен постоянным.
//
// Людей (рекордер, MCP) это не касается вовсе: их токен и есть их личность.
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import type { TokenResult } from "../_shared/google-calendar.ts";
import type { Attendee } from "../_shared/meeting-roster.ts";
import type { GEvent } from "../meeting-current/select.ts";

export class AgentScopeError extends Error {
  constructor(public readonly status: 403 | 503, message: string) {
    super(message);
    this.name = "AgentScopeError";
  }
}

/** Откуда брать календарь человека. Вынесено, чтобы границы проверялись без живого Google. */
export interface CalendarSource {
  refreshToken(telegramId: number): Promise<string | null>;
  accessToken(refresh: string): Promise<TokenResult>;
  listEvents(token: string, timeMin: string, timeMax: string, maxResults: number): Promise<GEvent[] | null>;
}

// Событий в окне трёх суток у одного человека заведомо меньше; больше — значит, не нашли бы и
// meeting-current, и честнее отказать, чем пропустить.
const MAX_EVENTS = 250;
const DAY_MS = 86_400_000;

/**
 * Ключ календарной встречи — ровно так, как его собирает meeting-current: `<iCalUID|id>:<дата>`,
 * где дата — локальная дата начала из самого события. Разъедется формат — сверка перестанет
 * находить свои же встречи и будет отказывать громко, а не пропускать молча.
 */
export function calendarKeyOf(ev: GEvent): string | null {
  const start = ev.start?.dateTime;
  if (!start) return null;
  return `${ev.iCalUID ?? ev.id}:${start.slice(0, 10)}`;
}

function dateOfKey(key: string): string | null {
  const m = /:(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? m[1] : null;
}

/**
 * Календарная встреча, заводимая агентом, обязана быть в календаре названного человека.
 * Отказ — исключением: 403, если человека в ней нет или сверить нечем, 503 — если календарь
 * временно не ответил (сверка не выполнена ≠ сверка пройдена).
 */
export async function assertCalendarMembership(
  source: CalendarSource,
  identity: AgentIdentity,
  body: { identity_kind: string; identity_key: string },
): Promise<void> {
  if (identity.kind !== "bot" || body.identity_kind !== "calendar") return;

  const date = dateOfKey(body.identity_key);
  if (!date) {
    throw new AgentScopeError(403, "service agent: calendar meeting key carries no date");
  }
  const refresh = await source.refreshToken(identity.telegramId);
  if (!refresh) {
    throw new AgentScopeError(
      403,
      "service agent: calendar meeting cannot be verified — the person has no Google Calendar connected; start the bot manually",
    );
  }
  const tok = await source.accessToken(refresh);
  if (!tok.ok) {
    throw new AgentScopeError(
      503,
      "service agent: the person's calendar is unavailable — retry or start the bot manually",
    );
  }
  const day = Date.parse(`${date}T00:00:00Z`);
  const events = await source.listEvents(
    tok.token,
    new Date(day - DAY_MS).toISOString(),
    new Date(day + 2 * DAY_MS).toISOString(),
    MAX_EVENTS,
  );
  if (!events) {
    throw new AgentScopeError(
      503,
      "service agent: the person's calendar is unavailable — retry or start the bot manually",
    );
  }
  if (!events.some((ev) => calendarKeyOf(ev) === body.identity_key)) {
    console.warn(
      `agent-scope: агент ${
        identity.agentId ?? "?"
      } просил календарную встречу ${body.identity_key} за ${identity.telegramId} — в его календаре её нет`,
    );
    throw new AgentScopeError(403, "service agent: the person is not a participant of this calendar meeting");
  }
}

function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}

/**
 * Может ли агент встать в уже открытую встречу — найденную по ключу или склеенную по составу.
 *
 * @param personEmail почта человека, за которого действует агент.
 * @param provenKey   ключ, который assertCalendarMembership уже подтвердил календарём человека.
 */
export function mayJoinExisting(
  identity: AgentIdentity,
  personEmail: string | null,
  row: { identity_key: string | null; claim_owner: number | null; attendees: Attendee[] | null },
  provenKey: string | null,
): boolean {
  if (identity.kind !== "bot") return true;
  if (provenKey !== null && row.identity_key === provenKey) return true;
  if (row.claim_owner === identity.telegramId) return true;
  const roster = (row.attendees ?? []).map((a) => normEmail(a.email)).filter((e) => e !== null);
  // Состава нет (ручная, комнатная, одиночное событие) — сверять не с чем, D016 оставляет как есть.
  if (roster.length === 0) return true;
  const me = normEmail(personEmail);
  return me !== null && roster.includes(me);
}
