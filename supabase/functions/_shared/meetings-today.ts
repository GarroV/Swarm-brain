// «Встречи сегодня» — календарные события дня для правой колонки главной (issue #218).
//
// Решение владельца 03.09.2026: «справа вместо задач команды мы делаем модуль "встречи
// сегодня" — тянем то что есть в календаре с возможностью быстрого перехода во встречу»,
// плюс уточнение «блок с грядущими встречами ставим выше, блок записанных встреч ниже».
//
// Здесь только ЧИСТАЯ логика отбора и раскладки: сам поход в Google живёт в вызывающем
// (swarm-api), скоринг «какая идёт прямо сейчас» — в meeting-current/select.ts (там он про
// одну встречу для рекордера, а тут нужен весь день).
import type { GEvent } from "../meeting-current/select.ts";

/**
 * Что рекордер видит прямо сейчас — из его heartbeat (`allowed_users.recorder_last_*`).
 * Два ФАКТА, а не один: в звонке можно сидеть без записи (решение владельца 04.09.2026,
 * канон — docs/decisions/2026-09-04-on-air-v-panele-vstrech.md).
 */
export type RecorderPresence = {
  /** Ключ встречи, которую рекордер видит: «<uid>:<дата>», как в meeting-claim. */
  meetingKey: string | null;
  /** Вход микрофона держит ДРУГОЕ приложение — идёт реальный созвон (CallDetector). */
  onCall: boolean;
  /** Рекордер пишет этот звонок. */
  recording: boolean;
  /** Время последнего heartbeat. */
  lastSeen: string | null;
};

/**
 * За сколько присутствие считается устаревшим. Пока звонок идёт, рекордер шлёт keep-alive
 * раз в 2 минуты, поэтому пятиминутная тишина — это спящий ноут или обрыв сети, а не «всё
 * ещё в звонке». Границу по ВРЕМЕНИ ВСТРЕЧИ здесь не проверяем: её задаёт сам рекордер
 * (meeting-current отдаёт ключ только в окне ±10 мин от слота), а лишняя проверка погасила бы
 * затянувшийся созвон, где люди ещё говорят.
 */
const PRESENCE_TTL_MS = 5 * 60_000;

export type TodayMeeting = {
  id: string;
  title: string | null;
  /** ISO-время начала и конца — форматирует клиент по локали пользователя. */
  starts_at: string;
  ends_at: string;
  /** Ссылка «зайти в звонок», только https (см. joinLink). null — ссылки нет. */
  join_url: string | null;
  /** Идёт прямо сейчас. */
  is_now: boolean;
  /** Уже закончилась. Такие показываем приглушённо — «что было днём» тоже полезно. */
  is_past: boolean;
  /** Сколько людей в приглашении (без нас): «1:1» и «совещание» читаются по-разному. */
  attendees: number;
  /** Ты сам в этом звонке прямо сейчас — панель показывает `ON AIR`. */
  on_call: boolean;
  /** …и рекордер его пишет — рядом с `ON AIR` встаёт `REC`. */
  recording: boolean;
};

/**
 * Отбор событий дня. Выкидываем то, что встречей не является:
 *   • отменённые (`status: cancelled`) — их в календаре видно зачёркнутыми, в списке они шум;
 *   • «свободен» (`transparency: transparent`) — это OOO/напоминания, а не созвон;
 *   • события на весь день (`start.date` без времени) — дни рождения, отпуска, дедлайны.
 * Порядок — по времени начала: день читается сверху вниз, как в календаре.
 */
export function todayMeetings(
  events: GEvent[],
  now: Date,
  joinLinkOf: (e: GEvent) => string | null,
  presence?: RecorderPresence | null,
): TodayMeeting[] {
  const t = now.getTime();
  // Присутствие протухло (или его нет) — дальше сравнивать ключи незачем.
  const live = presence?.meetingKey && presence.lastSeen &&
    t - Date.parse(presence.lastSeen) <= PRESENCE_TTL_MS
    ? presence
    : null;
  return events
    .filter((e) => e.status !== "cancelled")
    .filter((e) => e.transparency !== "transparent")
    .filter((e) => !!e.start?.dateTime && !!e.end?.dateTime)
    .map((e) => {
      const starts = e.start!.dateTime!;
      const ends = e.end!.dateTime!;
      const s = Date.parse(starts);
      const en = Date.parse(ends);
      const id = e.iCalUID ?? e.id;
      // Ключ несёт и дату: у повторяющейся встречи uid один на всю серию, и сравнение по
      // одному uid зажгло бы ON AIR на вчерашнем экземпляре.
      const mine = live?.meetingKey === `${id}:${starts.slice(0, 10)}`;
      return {
        id,
        title: e.summary?.trim() || null,
        starts_at: starts,
        ends_at: ends,
        join_url: joinLinkOf(e),
        is_now: s <= t && t < en,
        is_past: en <= t,
        // Себя не считаем: «участников 1» у встречи вдвоём выглядит ошибкой.
        attendees: (e.attendees ?? []).filter((a) => !a.self).length,
        on_call: mine ? live!.onCall : false,
        recording: mine ? live!.recording : false,
      };
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

/**
 * Границы «сегодня» в поясе ПОЛЬЗОВАТЕЛЯ — у сервера своего пояса нет, edge-функция живёт в UTC.
 *
 * `offsetMinutes` — на сколько минут местное время ВПЕРЕДИ UTC (Белград летом = +120).
 * В браузере это `-new Date().getTimezoneOffset()`: у `getTimezoneOffset` знак обратный,
 * и именно на этом знаке первая редакция и ошиблась — тест поймал сдвиг на четыре часа.
 */
export function dayBounds(nowISO: string, offsetMinutes: number): { timeMin: string; timeMax: string } {
  const now = new Date(nowISO);
  // UTC → местное время, чтобы взять КАЛЕНДАРНУЮ дату пользователя (у него уже может быть
  // следующий день, когда в UTC ещё вчера — ровно про это вся функция).
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  // Местная полночь и местные 23:59:59 → обратно в UTC (вычитаем смещение).
  return {
    timeMin: new Date(Date.UTC(y, m, d, 0, 0, 0) - offsetMinutes * 60_000).toISOString(),
    timeMax: new Date(Date.UTC(y, m, d, 23, 59, 59) - offsetMinutes * 60_000).toISOString(),
  };
}
