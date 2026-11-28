import type { InviteRecord } from "./fake-swarm-types.ts";

/**
 * Targeted take/start acknowledgement used by the push transport smoke.
 */
export function takeSignalledInvite(
  parsed: Record<string, unknown> | null,
  invites: Map<string, InviteRecord>,
  grants: Set<string>,
) {
  if (typeof parsed?.id !== "string") return null;
  const record = invites.get(parsed.id);
  const reply = (status: number, rows: InviteRecord[] = []) => ({
    status,
    requestBody: parsed,
    responseBody: { ok: status === 200, invites: rows.map((row) => row.invite) },
  });
  if (record === undefined) return reply(404);
  if (record.used || record.started === true) return reply(200);
  if (Date.parse(record.invite.expires_at) <= Date.now()) return reply(410);
  if (parsed.started === true) {
    if (!record.taken) return reply(409);
    record.started = true;
    return reply(200);
  }
  record.taken = true;
  grants.add(record.invite.grant_token);
  return reply(200, [record]);
}
