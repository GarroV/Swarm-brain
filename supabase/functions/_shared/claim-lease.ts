// Лиз права транскрибации встречи (meetings.lease_expires_at). Выдаёт meeting-claim тому, кто
// занял встречу; продлевает meeting-heartbeat ударом бота scriba по своей встрече — бот заявляется
// до захода в звонок и пишет дольше срока, а claim после истечения занимает встречу как брошенную.
// Один срок на обе функции: разойдись они, живой бот выглядел бы истёкшим раньше, чем его продлят.

/** На сколько выдаётся (и продлевается) право транскрибации. */
export const CLAIM_LEASE_TTL_SEC = 1800;

/** До какого момента действует лиз, выданный в `nowIso`. */
export function claimLeaseUntil(nowIso: string): string {
  return new Date(Date.parse(nowIso) + CLAIM_LEASE_TTL_SEC * 1000).toISOString();
}
