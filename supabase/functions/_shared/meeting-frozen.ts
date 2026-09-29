// «Правленное человеком или опубликованное команде не трогает никто» — одно правило на все пути,
// которыми автоматика пишет во встречу: claim (арбитр), ingest (вторая запись, претендент),
// очередь второй записи и финал обработки. Раньше каждое место проверяло своё: ingest смотрел
// только на правку человека, и запись, пришедшая после публикации, переписывала стенограмму и
// тезисы встречи, которую команда уже прочла.
//
// Публикация (swarm-api, POST publish) ставит status='in_base' и правкой не считается, поэтому
// заморозку дают оба признака. status в базе NOT NULL (миграция meetings), `neq` безопасен.

export interface FreezeRow {
  notes_edited_at: string | null;
  /** Может отсутствовать в выборке старого места вызова — тогда решает только правка. */
  status?: string | null;
}

export const PUBLISHED_STATUS = "in_base";

export function isFrozen(row: FreezeRow): boolean {
  return row.notes_edited_at !== null || row.status === PUBLISHED_STATUS;
}

interface FilterableQuery<Q> {
  is(column: string, value: null): Q;
  neq(column: string, value: string): Q;
}

/** Условие той же UPDATE: запись не ложится на встречу, замороженную после нашего чтения. */
export function unfrozen<Q extends FilterableQuery<Q>>(query: Q): Q {
  return query.is("notes_edited_at", null).neq("status", PUBLISHED_STATUS);
}
