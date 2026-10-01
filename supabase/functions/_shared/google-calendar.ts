// Доступ к Google Calendar по серверной OAuth-интеграции. Один модуль на всех потребителей:
// `meeting-current` (какая встреча идёт сейчас — для рекордера) и `swarm-api /calendar/today`
// (панель «Встречи сегодня» на главной, issue #218).
//
// Вынесено из meeting-current 03.09.2026: вторая копия обмена refresh→access и запроса
// событий гарантированно разъехалась бы с первой — ровно тот случай, про который в
// documentation.md написано «дубли = главный источник дрифта».
import type { GEvent } from "../meeting-current/select.ts";
import { externalFetch } from "./external-fetch.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

// Результат обмена refresh→access. `deadGrant` различает ДВЕ разные причины отказа (issue #302):
// Google вернул именно invalid_grant/invalid_client (400 — токен реально отозван/протух, юзеру
// правда нужно переподключиться) vs что угодно другое (429 рейт-лимит, 5xx, обрыв сети — временная
// запинка). До фикса обе трактовались одинаково как «токен мёртв» → рекордер спамил «переподключи
// календарь» на каждый чих Google, хотя реального разрыва не было.
/**
 * Срок одного запроса к Google. Без него повисший ответ держит вызывающего до потолка среды, а обход
 * автозапуска (meeting-calendar/sweep.ts) ждёт всех людей воркспейса разом — один завис, встали все.
 * Истёкший срок и обрыв сети — временная запинка (как 5xx), а не мёртвый токен.
 */
export const GOOGLE_TIMEOUT_MS = 8_000;

/** fetch со сроком; сбой сети и истёкший срок — null (вызывающий трактует как «Google не ответил»).
 *  Одна попытка: два вызова подряд обязаны уложиться в ожидание оркестратора (см. тест), повтор
 *  этот бюджет бы съел. */
async function fetchBounded(url: string, init: RequestInit, timeoutMs: number, what: string): Promise<Response | null> {
  try {
    return await externalFetch(url, init, { service: "google-calendar", timeoutMs, attempts: 1 });
  } catch (e) {
    console.error(`google-calendar ${what}: запрос не прошёл (${e instanceof Error ? e.name : "error"})`);
    return null;
  }
}

export type TokenResult = { ok: true; token: string } | { ok: false; deadGrant: boolean };

// invalid_grant/invalid_client — единственные коды, которые Google документирует как «этот
// refresh_token больше никогда не сработает» (отозван вручную, протух, сменился пароль). Всё
// остальное (429 рейт-лимит, 5xx, сетевой сбой) может пройти при следующей попытке — считать это
// «мёртвым токеном» и звать пользователя переподключаться на пустом месте (issue #302).
export function isDeadGrantError(status: number, body: string): boolean {
  return status === 400 && /"error"\s*:\s*"(invalid_grant|invalid_client)"/.test(body);
}

/** refresh_token → access_token. Любую осечку логируем (не сам токен, только код и текст ошибки Google) —
 *  раньше отказ был молчаливым, и постфактум нельзя было понять, что случилось. */
export async function accessToken(refresh: string, timeoutMs = GOOGLE_TIMEOUT_MS): Promise<TokenResult> {
  const res = await fetchBounded(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    },
    timeoutMs,
    "accessToken",
  );
  if (res === null) return { ok: false, deadGrant: false };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const deadGrant = isDeadGrantError(res.status, body);
    console.error(
      `google-calendar accessToken: status=${res.status} deadGrant=${deadGrant} body=${body.slice(0, 300)}`,
    );
    return { ok: false, deadGrant };
  }
  const data = await res.json();
  const token = data.access_token ?? null;
  if (!token) {
    console.error("google-calendar accessToken: 200 без access_token в ответе");
    return { ok: false, deadGrant: false };
  }
  return { ok: true, token };
}

/**
 * События с причиной отказа. `status` — код ответа Google (401/403 — доступа нет: токен не тот или нет
 * права на календарь; прочее — запинка), `null` — Google не ответил или тело оборвалось.
 */
export type EventsResult = { ok: true; events: GEvent[] } | { ok: false; status: number | null };

/** События основного календаря в окне. `null` — Google ответил ошибкой (её отличаем от «пусто»). */
export async function listEvents(
  token: string,
  timeMin: string,
  timeMax: string,
  maxResults = 25,
  timeoutMs = GOOGLE_TIMEOUT_MS,
): Promise<GEvent[] | null> {
  const r = await listEventsResult(token, timeMin, timeMax, maxResults, timeoutMs);
  return r.ok ? r.events : null;
}

/** То же, что listEvents, но отказ несёт код ответа: проверке календаря нужно отличить «нет доступа» от сбоя. */
export async function listEventsResult(
  token: string,
  timeMin: string,
  timeMax: string,
  maxResults = 25,
  timeoutMs = GOOGLE_TIMEOUT_MS,
): Promise<EventsResult> {
  const q = new URLSearchParams({
    singleEvents: "true", // повторяющиеся раскрываются в экземпляры, иначе слот без даты
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: String(maxResults),
  });
  const res = await fetchBounded(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    timeoutMs,
    "listEvents",
  );
  if (res === null) return { ok: false, status: null };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`google-calendar listEvents: status=${res.status} body=${body.slice(0, 300)}`);
    return { ok: false, status: res.status };
  }
  try {
    return { ok: true, events: ((await res.json()).items ?? []) as GEvent[] };
  } catch {
    // Тело оборвалось или истёк срок посреди чтения — та же запинка Google, а не «событий нет».
    return { ok: false, status: null };
  }
}
