// Совладельцы черновика встречи (таблица `meetings`, колонка `co_owners`).
//
// Решение владельца 2026-09-25 (docs/decisions/2026-09-25-cards-in-panel.md, п. 26–27):
// «если на встрече были другие пользователи сворма - значит встреча доступна им. если встреча
// была 1-1 , но второй юзер не пользователь сворма - значит мы записываем в владельца только того
// кто бота запустил». Владельцы черновика = записавшие (`recorders`) ∪ совладельцы (`co_owners`).
// Совладелец видит и вычитывает черновик, но удалить его может только записавший.
//
// Совладельцы считаются при claim, а не при чтении: права на старый черновик не должны молча
// расширяться оттого, что в команду позже добавили человека с той же почтой.

export type Attendee = { email?: string | null; name?: string | null };
export type Member = { telegram_id: number | null; email: string | null };

const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();

/** Участники встречи, у которых есть вход в SWARM (тот же воркспейс), кроме записавших. */
export function coOwnersFromAttendees(
  attendees: Attendee[] | null | undefined,
  members: Member[],
  recorderIds: number[],
): number[] {
  const emails = new Set((attendees ?? []).map((a) => norm(a?.email)).filter(Boolean));
  const skip = new Set(recorderIds);
  const out = new Set<number>();
  for (const m of members) {
    if (m.telegram_id == null || skip.has(m.telegram_id)) continue;
    const e = norm(m.email);
    if (e && emails.has(e)) out.add(m.telegram_id);
  }
  return [...out].sort((a, b) => a - b);
}

/** Склейка участников двух claim одной встречи: по e-mail без учёта регистра, порядок сохраняется. */
export function mergeAttendees<T extends Attendee>(
  existing: T[] | null | undefined,
  incoming: T[] | null | undefined,
): T[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((a) => norm(a?.email)).filter(Boolean));
  for (const a of incoming ?? []) {
    const e = norm(a?.email);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(a);
  }
  return out;
}
