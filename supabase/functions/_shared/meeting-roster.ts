// meeting-roster — «одна ли это встреча» для claim, когда ключи идентичности НЕ сравнимы.
//
// Зачем: identity_key описывает не встречу, а то, КАК её увидел клиент. Участник с событием в
// Google-календаре присылает `<event-id>:<дата>`, участник, пришедший по ссылке, — `kontur:<room>`
// (рекордер выбирает ОДИН ключ, календарь приоритетнее — AppDelegate.handleDetection). Ключи не
// совпадают, уникальный индекс конфликта не видит, и claim открывает ВТОРУЮ встречу: два аудио,
// две транскрибации (деньги), два черновика, два набора тезисов (issues #164, #168, #176).
//
// Как ключуют одну встречу ботовые системы (ресерч 2026-08-28, docs/research/…): ключ — комната
// платформы (Vexa: platform + native_meeting_id; Attendee: нормализованный URL звонка), потому
// что комната общая у всех участников. Нам этот ключ доступен не всегда, поэтому опираемся на
// то, что есть у сервера: время + состав.
//
// Уклон в ТОЧНОСТЬ: ложная склейка сводит РАЗНЫЕ разговоры в одну запись и показывает человеку
// чужой транскрипт — это хуже дубля. Поэтому одного пересечения по времени недостаточно никогда.

/** Окно пересечения по времени. Рекордер стартует не ровно в :00, Granola подключается позже. */
export const ROSTER_TOLERANCE_MIN = 10;

export type Attendee = { name?: string; email?: string };

export type RosterSide = {
  /** ISO начала записи/встречи. Без него сопоставлять нечего. */
  startedAt: string | null;
  /** Участники, как их видит эта сторона (у записи из комнаты список пуст). */
  attendees: Attendee[];
  /** E-mail того, кто записывал эту сторону (клеймящий / claim_owner). */
  ownerEmail?: string | null;
};

export type RosterVerdict = {
  same: boolean;
  reason:
    | "owner_in_roster"   // записавший одной стороны есть в списке участников другой
    | "roster_overlap"    // сильное пересечение составов
    | "no_time"           // время неизвестно — не сопоставляем
    | "time_apart"        // встречи в разное время
    | "no_signal";        // время близко, но подтверждения нет
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function emails(list: Attendee[]): Set<string> {
  return new Set(list.map((a) => norm(a?.email)).filter(Boolean));
}

function people(list: Attendee[]): Set<string> {
  return new Set(list.map((a) => norm(a?.email) || norm(a?.name)).filter(Boolean));
}

function minutesApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime(), tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.abs(ta - tb) / 60000;
}

/**
 * Одна ли это встреча. Требуется И близкое время, И подтверждающий сигнал по людям:
 *
 *   • записавший одной стороны есть в участниках другой — главный сигнал для записи из комнаты:
 *     у неё нет ни названия, ни списка участников, но сам человек в календарном списке есть
 *     (живой случай 26.08: коллега писала «IT+BD» через Контур.Толк, её e-mail есть в attendees
 *     календарной записи владельца);
 *   • сильное пересечение составов (≥2 человека И ≥ половины меньшего списка) — та же калибровка,
 *     что в дедупе записей: разные встречи делят одного-двух человек, дубли несут один инвайт.
 *
 * Одного времени НЕ достаточно: в 09:00 идут несколько разных созвонов (проверено на проде —
 * «Dodo Pizza Serbia» и «HU OPS standards» в одну минуту у разных людей).
 */
export function sameMeetingByRoster(inc: RosterSide, cand: RosterSide): RosterVerdict {
  const apart = minutesApart(inc.startedAt, cand.startedAt);
  if (apart === null) return { same: false, reason: "no_time" };
  if (apart > ROSTER_TOLERANCE_MIN) return { same: false, reason: "time_apart" };

  const incOwner = norm(inc.ownerEmail);
  const candOwner = norm(cand.ownerEmail);
  if (incOwner && emails(cand.attendees).has(incOwner)) return { same: true, reason: "owner_in_roster" };
  if (candOwner && emails(inc.attendees).has(candOwner)) return { same: true, reason: "owner_in_roster" };

  const a = people(inc.attendees), b = people(cand.attendees);
  let overlap = 0;
  for (const p of a) if (b.has(p)) overlap++;
  const small = Math.min(a.size, b.size);
  if (overlap >= 2 && overlap >= Math.ceil(0.5 * small)) return { same: true, reason: "roster_overlap" };

  return { same: false, reason: "no_signal" };
}

/**
 * Ключ комнаты уникален только внутри ДНЯ: `kontur:<room>` / `meet:<code>` у регулярной встречи
 * постоянны (у повторяющегося события Google Meet одна ссылка на всю серию, в Контур.Толк бывают
 * личные комнаты), а `meetings.identity_key` накрыт глобально уникальным индексом. Без дневного
 * суффикса второй созвон в той же комнате находил СТАРУЮ строку: опубликованную — `defer`, то есть
 * запись не создавалась вовсе; неопубликованную — перехватывал и перезаписывал (issue #181).
 * Календарный ключ уже несёт дату (`<event-id>:<дата>`), manual уникален сам по себе.
 *
 * Суффикс добавляет СЕРВЕР, а не клиент: у команды стоят разные сборки рекордера, и старая
 * продолжает присылать ключ без даты.
 */
export function scopeRoomKey(kind: string, key: string, startedAt: string | null): string {
  if (kind !== "room") return key;
  const day = (startedAt ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return key;   // времени нет — оставляем как есть
  if (key.endsWith(`:${day}`)) return key;            // уже сужен (повторный claim той же записи)
  return `${key}:${day}`;
}
