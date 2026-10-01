// Доступ к ЧЕРНОВИКУ встречи на вычитке (таблица `meetings`, status=awaiting_review).
//
// Правило (решение владельца 2026-08-20): черновик видит ТОЛЬКО тот, кто его записал.
// Админ — НЕ исключение. Это сырая запись чужого разговора: полный транскрипт, ещё не вычитанный
// и не опубликованный автором. До этого админ мог открыть чужой черновик целиком и даже
// опубликовать его за автора; проверено на проде — открывались 834 сегмента живого разговора
// коллеги.
//
// Согласуется с политикой приватных записей/встреч (`entries`, is_private) — там admin-байпаса
// тоже нет (решение владельца 2026-08-07). Отличие от ЗАДАЧ: у задач оверсайт админа сохранён
// намеренно, см. `_shared/tasks/access.ts`.
//
// Совладельцы (решение владельца 2026-09-25, п. 26–27 журнала cards-in-panel): участники встречи,
// у которых есть SWARM, тоже владельцы черновика — `co_owners`, считаются при claim
// (`_shared/meeting-owners.ts`). Видят и вычитывают; удалить черновик может только записавший.
// Встречу с несколькими владельцами публикуют только в общую базу.
//
// Приглядеть, у кого копится вычитка, админ может агрегатом БЕЗ контента:
// GET /admin/review-counts (имя + число).

export type DraftMeetingRow = {
  group_id?: string | null;
  recorders?: Array<{ telegram_id: number }> | null;
  co_owners?: number[] | null;
  /** Участники из календаря (`meetings.attendees`) — нужны, чтобы отличить 1-1 от встречи втроём. */
  attendees?: Array<{ email?: string | null; resource?: boolean | null }> | null;
};

// bigint из базы может прийти строкой — приводим к числу. Ноль и нечисла выбрасываем;
// отрицательный id — НЕ мусор: это веб-пользователь без Telegram (вход по e-mail).
const toId = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n !== 0 ? n : null;
};

const recorderIds = (m: DraftMeetingRow): number[] =>
  (m.recorders ?? []).map((r) => r?.telegram_id).filter((id): id is number => typeof id === "number");

/** Все владельцы черновика: записавшие ∪ совладельцы, без повторов. */
function ownerIds(m: DraftMeetingRow): number[] {
  const ids = [...(m.recorders ?? []).map((r) => toId(r?.telegram_id)), ...(m.co_owners ?? []).map(toId)];
  return [...new Set(ids.filter((id): id is number => id !== null))];
}

// Переговорка в календаре Google — ресурс, а не человек.
const isRoom = (a: { email?: string | null; resource?: boolean | null }): boolean =>
  a.resource === true || /@resource\.calendar\.google\.com$/i.test((a.email ?? "").trim());

/** Сколько разных людей в календарной записи встречи (по e-mail, без переговорок). */
function calendarHumans(m: DraftMeetingRow): number {
  const emails = (m.attendees ?? [])
    .filter((a) => a != null && !isRoom(a))
    .map((a) => (a.email ?? "").trim().toLowerCase())
    .filter(Boolean);
  return new Set(emails).size;
}

/**
 * Встреча 1-1 (#641, решение владельца 30.09.2026): ровно два человека — оба в SWARM. Тогда её
 * можно опубликовать «в личное» ОДНОЙ записью на двоих. Возвращает id второго участника для
 * `viewerId` или `null`, если встреча не 1-1 или смотрящий не из этой пары.
 *
 * Людей считаем по двум источникам, и оба должны сойтись на «двое»:
 *  - владельцы черновика (записавшие ∪ совладельцы) — ровно двое, смотрящий среди них;
 *  - календарь: людей в нём не больше двух. Третий участник без SWARM в владельцы не попадает,
 *    но встреча с ним уже не 1-1, и прятать её от команды «на двоих» нельзя.
 * Без календаря (запись комнаты) решают одни владельцы.
 */
export function oneOnOnePartner(meeting: DraftMeetingRow, viewerId: number): number | null {
  const owners = ownerIds(meeting);
  if (owners.length !== 2 || !owners.includes(viewerId)) return null;
  if (calendarHumans(meeting) > 2) return null;
  return owners.find((id) => id !== viewerId) ?? null;
}

/**
 * Может ли `viewerId` открыть черновик. `isAdmin` принимается, чтобы вызывающему не приходилось
 * гадать, нужен ли он, — и намеренно НЕ влияет на результат: так видно, что оверсайт здесь
 * рассмотрен и отклонён, а не забыт.
 */
export function canAccessDraftMeeting(
  meeting: DraftMeetingRow | null | undefined,
  viewerId: number,
  _isAdmin: boolean,
  viewerGroupId: string | null | undefined,
): boolean {
  if (!meeting) return false;
  if (!viewerGroupId || meeting.group_id !== viewerGroupId) return false;
  return recorderIds(meeting).includes(viewerId) || (meeting.co_owners ?? []).includes(viewerId);
}

/** Удалить черновик может только записавший (запустил бота или рекордер), не совладелец. */
export function canDeleteDraftMeeting(meeting: DraftMeetingRow | null | undefined, viewerId: number): boolean {
  return !!meeting && recorderIds(meeting).includes(viewerId);
}

/** Больше одного владельца — тогда публикация только в общую базу. */
export function hasCoOwners(meeting: DraftMeetingRow): boolean {
  return new Set([...recorderIds(meeting), ...(meeting.co_owners ?? [])]).size > 1;
}

/**
 * Фильтр очереди вычитки для запроса к БД (`.or(...)`): только черновики, где смотрящий записывал
 * или стал совладельцем. Параметра «показать все» нет сознательно — раньше `?all=true` у админа
 * отдавал весь воркспейс. viewerId — число из токена, в фильтр не попадает ничего чужого.
 */
export function draftMeetingsOwnScopedFilter(viewerId: number): string {
  const id = Math.trunc(viewerId);
  return `recorders.cs.[{"telegram_id":${id}}],co_owners.cs.{${id}}`;
}
