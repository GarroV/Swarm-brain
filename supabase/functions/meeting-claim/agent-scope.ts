// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// До какой границы служебный агент действует за человека (решение D016, issue #371).
//
// resolveActingIdentity уже сверил, что человек — из воркспейса агента. Этого мало: граница по
// воркспейсу позволяет скомпрометированному или ошибившемуся токену завести приватную запись
// человеку, которого на звонке не было. Здесь граница сужается до СОСТАВА ВСТРЕЧИ.
//
// Главное правило модуля: всё, что агент прислал о встрече, — его собственное утверждение, а
// скомпрометированный токен утверждает что угодно. Поэтому:
//
//   • ТИП встречи сервер определяет сам — по форме ключа. Иначе агент объявлял бы календарное
//     событие «комнатой» или «ручной» и уходил от сверки (найдено ревью на приёмке блока);
//   • календарная встреча обязана быть в Google-календаре названного человека — сервер смотрит
//     сам, и СОСТАВ берёт из этого же события, а не из тела запроса;
//   • у комнатной встречи агента состав из тела не берётся вовсе: его не с чем сверить, а
//     по нему идёт склейка с чужими встречами;
//   • к уже открытой встрече агент встаёт, только если она его человека: календарная — есть в
//     его календаре, комнатная — он в её составе (состава нет — D016 оставляет открытой);
//   • ручная встреча — без сверки (D015, D016).
//
// Людей (рекордер, MCP) это не касается вовсе: их токен и есть их личность.
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import type { TokenResult } from "../_shared/google-calendar.ts";
import type { GEvent } from "../meeting-current/select.ts";

export class AgentScopeError extends Error {
  constructor(public readonly status: 400 | 403 | 503, message: string) {
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

export type ScopeAttendee = { name?: string | null; email?: string | null };

/** Что сервер знает о встрече агента сам, без его слов. */
export interface AgentScope {
  /** Состав, которым заменяется присланный агентом. `undefined` — ручная ветка, не трогаем. */
  attendees: ScopeAttendee[] | undefined;
  /** Ключи встреч из календаря названного человека вокруг даты встречи. */
  calendarKeys: Set<string>;
}

// Событий в окне трёх суток у одного человека заведомо меньше; больше — значит, не нашли бы и
// meeting-current, и честнее отказать, чем пропустить.
const MAX_EVENTS = 250;
const DAY_MS = 86_400_000;

// Формы ключей, которые на деле шлют клиенты:
//   календарь — meeting-current: `<iCalUID|id>:<YYYY-MM-DD>`;
//   комнаты   — рекордер (BrowserRoom.swift parseRoom): `meet:<код>` (строчные буквы и дефисы,
//               10–14 символов), `kontur:<комната>` (буквы, цифры, `-`, `_`); сервер сужает их до
//               дня суффиксом `:<YYYY-MM-DD>` (scopeRoomKey), повторный claim приходит уже с ним.
//   `zoom:<id>` появится с T121 — до тех пор агенту это не комната.
const DATE_SUFFIX = /:(\d{4}-\d{2}-\d{2})$/;
const ROOM_PREFIX = /^(meet|kontur|zoom):/;
const ROOM_KEY = /^(meet:[a-z-]{10,14}|kontur:[\p{L}\p{N}_-]+)(:\d{4}-\d{2}-\d{2})?$/u;
const CALENDAR_KEY = /^\S+:\d{4}-\d{2}-\d{2}$/;

export type KeyShape = "calendar" | "room" | "other" | "invalid";

export function keyShape(key: string): KeyShape {
  if (ROOM_PREFIX.test(key)) return ROOM_KEY.test(key) ? "room" : "invalid";
  if (DATE_SUFFIX.test(key)) return CALENDAR_KEY.test(key) ? "calendar" : "invalid";
  return "other";
}

const KIND_OF_SHAPE: Record<KeyShape, string | null> = {
  calendar: "calendar",
  room: "room",
  other: "manual",
  invalid: null,
};

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

type Loaded = { events: GEvent[] } | { failure: "not_connected" | "unavailable" };

async function loadCalendar(source: CalendarSource, telegramId: number, date: string): Promise<Loaded> {
  const refresh = await source.refreshToken(telegramId);
  if (!refresh) return { failure: "not_connected" };
  const tok = await source.accessToken(refresh);
  if (!tok.ok) return { failure: "unavailable" };
  const day = Date.parse(`${date}T00:00:00Z`);
  const events = await source.listEvents(
    tok.token,
    new Date(day - DAY_MS).toISOString(),
    new Date(day + 2 * DAY_MS).toISOString(),
    MAX_EVENTS,
  );
  return events ? { events } : { failure: "unavailable" };
}

function keysOf(events: GEvent[]): Set<string> {
  return new Set(events.map(calendarKeyOf).filter((k): k is string => k !== null));
}

const UNAVAILABLE = "service agent: the person's calendar is unavailable — retry or start the bot manually";

async function calendarScope(
  source: CalendarSource,
  identity: AgentIdentity,
  key: string,
): Promise<AgentScope> {
  const date = DATE_SUFFIX.exec(key)![1];
  const loaded = await loadCalendar(source, identity.telegramId, date);
  if ("failure" in loaded) {
    if (loaded.failure === "unavailable") throw new AgentScopeError(503, UNAVAILABLE);
    throw new AgentScopeError(
      403,
      "service agent: calendar meeting cannot be verified — the person has no Google Calendar connected; start the bot manually",
    );
  }
  const event = loaded.events.find((ev) => calendarKeyOf(ev) === key);
  if (!event) {
    console.warn(
      `agent-scope: агент ${
        identity.agentId ?? "?"
      } просил календарную встречу ${key} за ${identity.telegramId} — в его календаре её нет`,
    );
    throw new AgentScopeError(403, "service agent: the person is not a participant of this calendar meeting");
  }
  // Та же выборка полей, что отдаёт meeting-current: встреча агента выглядит как встреча рекордера.
  const attendees = (event.attendees ?? [])
    .map((a) => ({ name: a.displayName ?? null, email: a.email ?? null }))
    .filter((a) => a.name || a.email);
  return { attendees, calendarKeys: keysOf(loaded.events) };
}

/**
 * Что сервер сам знает о встрече, которую просит агент. `null` — пришёл человек, сверки нет.
 * Отказ — исключением: 400 (тип встречи не совпадает с формой ключа), 403 (человека во встрече нет
 * или сверить нечем), 503 (календарь временно не ответил: сверка не выполнена ≠ сверка пройдена).
 */
export async function resolveAgentScope(
  source: CalendarSource,
  identity: AgentIdentity,
  body: { identity_kind: string; identity_key: string; started_at?: string; attendees?: unknown },
): Promise<AgentScope | null> {
  if (identity.kind !== "bot") return null;

  const shape = keyShape(body.identity_key);
  if (KIND_OF_SHAPE[shape] !== body.identity_kind) {
    console.warn(
      `agent-scope: агент ${
        identity.agentId ?? "?"
      } за ${identity.telegramId}: identity_kind=${body.identity_kind} при ключе формы ${shape}`,
    );
    throw new AgentScopeError(400, "service agent: identity_kind does not match the shape of identity_key");
  }

  if (shape === "calendar") return await calendarScope(source, identity, body.identity_key);

  if (shape === "room") {
    // Календарь нужен только склейке: встать в календарную встречу агент может, лишь если она
    // в календаре его человека. Нет календаря — ни одна календарная встреча ему не открыта.
    const date = (body.started_at ?? "").slice(0, 10);
    const loaded = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await loadCalendar(source, identity.telegramId, date) : null;
    const calendarKeys = loaded && "events" in loaded ? keysOf(loaded.events) : new Set<string>();
    return { attendees: [], calendarKeys };
  }

  // Ручная встреча: без сверки состава — решение владельца D016 (ручной путь постоянный по D015).
  // Что агент сам заводит ручную встречу без приглашения от сервера — вынесено владельцу отдельным
  // вопросом Q008 («ручной запуск по приглашению, выданному сервером»); до ответа не меняем.
  return { attendees: undefined, calendarKeys: new Set<string>() };
}

function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}

/**
 * Может ли агент встать в уже открытую встречу — найденную по ключу или склеенную по составу.
 *
 * @param personEmail почта человека, за которого действует агент.
 * @param scope       что сервер знает сам (resolveAgentScope); `null` у агента — не знает ничего.
 */
export function mayJoinExisting(
  identity: AgentIdentity,
  personEmail: string | null,
  row: { identity_key: string | null; claim_owner: number | null; attendees: ScopeAttendee[] | null },
  scope: AgentScope | null,
): boolean {
  if (identity.kind !== "bot") return true;
  if (row.claim_owner === identity.telegramId) return true;
  if (!scope) return false;
  // Календарная встреча — только из календаря человека. Состав строки не в счёт: его могли прислать.
  if (keyShape(row.identity_key ?? "") === "calendar") {
    return scope.calendarKeys.has(row.identity_key ?? "");
  }
  const roster = (row.attendees ?? []).map((a) => normEmail(a.email)).filter((e) => e !== null);
  // Состава нет (комнатная, ручная) — сверять не с чем, D016 оставляет как есть.
  if (roster.length === 0) return true;
  const me = normEmail(personEmail);
  return me !== null && roster.includes(me);
}
