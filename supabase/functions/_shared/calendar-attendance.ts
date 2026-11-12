// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Идёт ли человек на встречу из своего календаря — одно правило для всех, кто решает, приходит ли
// бот сам (решение D024): отбор заданий (calendar-dispatch.ts, а через него снимок дня) и сверка
// заявки бота в meeting-claim. Два разных правила в двух местах разъехались бы молча: отбор не
// повёл бы бота, а заявка пропустила бы.
//
// «Да» — только ответ accepted в собственной строке человека. «Может быть», «нет» и «не ответил»
// — бот не идёт: в календарь попадают и приглашения, которых человек не ждал. Своя встреча без
// поля ответа (Google не ведёт статус организатору встречи без списка гостей) считается «да» —
// иначе бот пропускал бы созвоны, которые человек поставил себе сам. Отдельного правила
// «организатор» нет: есть ответ — решает он.
import type { GEvent } from "../meeting-current/select.ts";

/**
 * Почты тех, кто принял встречу в этом событии: гости с ответом accepted, плюс организатор своей
 * встречи, если он считается «да» (`acceptedBySelf`). Решение владельца 12.11.2026: нотисы бота о
 * провале записи получают только принявшие — не ответивший, «может быть», отклонивший и не
 * участник их не видят. Статус чужого ответа есть только в событии запустившего (а у людей с
 * автозапуском — в их собственных событиях), в `meetings.attendees` его нет.
 */
export function acceptedEmails(ev: Pick<GEvent, "attendees" | "organizer">): string[] {
  const out = new Set<string>();
  for (const a of ev.attendees ?? []) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (a.responseStatus === "accepted" && email) out.add(email);
  }
  const organizer = (ev.organizer?.email ?? "").trim().toLowerCase();
  if (organizer && ev.organizer?.self === true && acceptedBySelf(ev)) out.add(organizer);
  return [...out].sort();
}

export function acceptedBySelf(ev: Pick<GEvent, "attendees" | "organizer">): boolean {
  const self = (ev.attendees ?? []).find((a) => a.self === true);
  if (self?.responseStatus !== undefined) return self.responseStatus === "accepted";
  return ev.organizer?.self === true;
}
