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
};

/**
 * Отбор событий дня. Выкидываем то, что встречей не является:
 *   • отменённые (`status: cancelled`) — их в календаре видно зачёркнутыми, в списке они шум;
 *   • «свободен» (`transparency: transparent`) — это OOO/напоминания, а не созвон;
 *   • события на весь день (`start.date` без времени) — дни рождения, отпуска, дедлайны.
 * Порядок — по времени начала: день читается сверху вниз, как в календаре.
 */
export function todayMeetings(events: GEvent[], now: Date, joinLinkOf: (e: GEvent) => string | null): TodayMeeting[] {
  const t = now.getTime();
  return events
    .filter((e) => e.status !== "cancelled")
    .filter((e) => e.transparency !== "transparent")
    .filter((e) => !!e.start?.dateTime && !!e.end?.dateTime)
    .map((e) => {
      const starts = e.start!.dateTime!;
      const ends = e.end!.dateTime!;
      const s = Date.parse(starts);
      const en = Date.parse(ends);
      return {
        id: e.iCalUID ?? e.id,
        title: e.summary?.trim() || null,
        starts_at: starts,
        ends_at: ends,
        join_url: joinLinkOf(e),
        is_now: s <= t && t < en,
        is_past: en <= t,
        // Себя не считаем: «участников 1» у встречи вдвоём выглядит ошибкой.
        attendees: (e.attendees ?? []).filter((a) => !a.self).length,
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
