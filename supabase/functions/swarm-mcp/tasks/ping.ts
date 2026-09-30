// Пинг задачи (`remind_date`) в MCP (issue #622). Чистая функция без сети — тестируется в ping.test.ts.
//
// Семантика — та же, что у PATCH /tasks/:id в swarm-api: перенос даты ВЗВОДИТ пинг заново
// (`reminded_at = null`), иначе уже сработавший пинг, передвинутый на новую дату, молча не пришёл
// бы — крон `task_pings_cron` берёт только неотправленные. Снятие (null) чистит и след отправки.

export type PingPatch =
  | { ok: true; fields: { remind_date: string | null; reminded_at: null; remind_set_by: number | null } }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Настоящая календарная дата YYYY-MM-DD: 2026-02-30 формат проходит, но такого дня нет. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function pingPatch(value: unknown, actorTelegramId: number | null): PingPatch {
  if (value === null) {
    return { ok: true, fields: { remind_date: null, reminded_at: null, remind_set_by: null } };
  }
  if (typeof value !== "string" || !isIsoDate(value)) {
    return { ok: false, error: "remind_date — дата YYYY-MM-DD или null, чтобы снять пинг." };
  }
  return { ok: true, fields: { remind_date: value, reminded_at: null, remind_set_by: actorTelegramId } };
}
