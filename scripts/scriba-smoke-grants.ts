// Пропуск бота на одну встречу (T165) для смоуков, которые засевают встречу напрямую, а не
// проходят забор приглашения через meeting-invite. Засевается то же, что выдал бы сервер:
// забранное агентом приглашение человека и пропуск по нему, уже привязанный к встрече (или ещё
// не привязанный — тогда его привяжет первая заявка). Выдачу пропуска настоящей дверью проверяют
// scriba-scope-smoke.ts (приглашения) и scriba-calendar-smoke.ts (задания).
//
// Уборка: `meeting_agent_grants?group_id=eq.<ws>` и `meeting_invites?group_id=eq.<ws>` удаляются
// до воркспейса (внешние ключи на workspaces без каскада).

export type Rest = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;

export interface GrantSeed {
  agentId: string;
  groupId: string;
  telegramId: number;
  /** Встреча, к которой пропуск уже привязан; null — привяжет первая заявка. */
  meetingId: string | null;
  joinUrl?: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Засеять забранное приглашение и пропуск по нему; вернуть пропуск и id приглашения. */
export async function seedInviteGrant(
  rest: Rest,
  seed: GrantSeed,
): Promise<{ token: string; inviteId: string; joinUrl: string }> {
  const now = Date.now();
  const joinUrl = seed.joinUrl ??
    `https://meet.google.com/grt-${crypto.randomUUID().slice(0, 8)}`;
  const [invite] = await rest("POST", "meeting_invites", [{
    group_id: seed.groupId,
    invited_by: seed.telegramId,
    join_url: joinUrl,
    platform: "meet",
    expires_at: new Date(now + 10 * 60_000).toISOString(),
    taken_at: new Date(now).toISOString(),
    taken_by: seed.agentId,
  }]) as Array<{ id: string }>;
  const token = `sgr_smoke_${crypto.randomUUID()}`;
  await rest("POST", "meeting_agent_grants", [{
    token_hash: await sha256Hex(token),
    agent_id: seed.agentId,
    group_id: seed.groupId,
    telegram_id: seed.telegramId,
    invite_id: invite.id,
    join_url: joinUrl,
    meeting_id: seed.meetingId,
    expires_at: new Date(now + 60 * 60_000).toISOString(),
  }]);
  return { token, inviteId: invite.id, joinUrl };
}

/** Пропуск на встречу `meetingId` за человека, один на пару (человек, встреча). */
export function grantCache(
  rest: Rest,
  base: { agentId: string; groupId: string },
) {
  const cache = new Map<string, Promise<string>>();
  return (telegramId: number, meetingId: string): Promise<string> => {
    const key = `${String(telegramId)}:${meetingId}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = seedInviteGrant(rest, { ...base, telegramId, meetingId }).then((
        g,
      ) => g.token);
      cache.set(key, hit);
    }
    return hit;
  };
}
