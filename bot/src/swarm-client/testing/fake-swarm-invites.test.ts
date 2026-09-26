/**
 * Приглашения в двойнике сервера (решение D017): `POST /meeting-invite` и сверка приглашения
 * в `meeting-claim`. Правила списаны с `supabase/functions/meeting-invite/index.ts` и
 * `_shared/meeting-invite.ts` (`checkInviteForClaim`). Двойник — оракул для оркестратора,
 * поэтому каждое правило обязано падать на сломанном входе.
 */
import { afterEach, describe, expect, it } from "vitest";

import { type FakeSwarm, startFakeSwarm } from "./fake-swarm.ts";

const TOKEN = "t";
const PERSON = 42;
const MEET = "https://meet.google.com/abc-defg-hij";

const servers: FakeSwarm[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

async function start(isStrict = false): Promise<FakeSwarm> {
  const server = await startFakeSwarm({
    token: TOKEN,
    onBehalfOf: PERSON,
    requiresInvites: isStrict,
  });
  servers.push(server);
  return server;
}

async function take(
  server: FakeSwarm,
  options: { body?: unknown; onBehalfOf?: string; token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${options.token ?? TOKEN}` };
  if (options.onBehalfOf !== undefined) headers["X-On-Behalf-Of"] = options.onBehalfOf;
  const response = await fetch(`${server.url}/meeting-invite`, {
    method: "POST",
    headers,
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

function ids(body: Record<string, unknown>): string[] {
  return (body.invites as { id: string }[]).map((invite) => invite.id);
}

async function claim(
  server: FakeSwarm,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${server.url}/meeting-claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "X-On-Behalf-Of": String(PERSON),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

const manual = (inviteId: string, joinUrl = MEET): Record<string, unknown> => ({
  identity_kind: "manual",
  identity_key: `scriba:${inviteId}`,
  invite_id: inviteId,
  join_url: joinUrl,
});

describe("POST /meeting-invite", () => {
  it("отдаёт приглашение с полями сервера и помечает его забранным", async () => {
    const server = await start();
    const invite = server.addInvite({ joinUrl: MEET });

    const { status, body } = await take(server);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.invites).toEqual([
      {
        id: invite.id,
        invited_by: PERSON,
        join_url: MEET,
        platform: "meet",
        created_at: invite.created_at,
        expires_at: invite.expires_at,
      },
    ]);
    expect(server.inviteState(invite.id)).toEqual({ taken: true, used: false });
  });

  it("каждое приглашение отдаётся ровно один раз", async () => {
    const server = await start();
    server.addInvite({ joinUrl: MEET });

    await take(server);
    const second = await take(server);

    expect(second.body.invites).toEqual([]);
  });

  it("два одновременных опроса не делят одно приглашение", async () => {
    const server = await start();
    for (let index = 0; index < 5; index += 1) server.addInvite({ joinUrl: MEET });

    const [left, right] = await Promise.all([take(server), take(server)]);
    const all = [...ids(left.body), ...ids(right.body)];

    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
  });

  it("истёкшее не отдаётся", async () => {
    const server = await start();
    server.addInvite({ joinUrl: MEET, expiresInMs: -1 });

    const answer = await take(server);

    expect(answer.body.invites).toEqual([]);
  });

  it("старые первыми и не больше limit", async () => {
    const server = await start();
    const first = server.addInvite({ joinUrl: MEET });
    const second = server.addInvite({ joinUrl: MEET });
    server.addInvite({ joinUrl: MEET });

    const { body } = await take(server, { body: { limit: 2 } });

    expect(ids(body)).toEqual([first.id, second.id]);
  });

  it.each([0, -1, 1.5, "2"])("limit %s — 400", async (limit) => {
    const server = await start();

    const answer = await take(server, { body: { limit } });

    expect(answer.status).toBe(400);
  });

  it("с X-On-Behalf-Of — 403: дверь агента подмену не принимает", async () => {
    const server = await start();
    server.addInvite({ joinUrl: MEET });

    const { status } = await take(server, { onBehalfOf: String(PERSON) });

    expect(status).toBe(403);
    const after = await take(server);
    expect(after.body.invites).toHaveLength(1);
  });

  it("чужой токен — 401", async () => {
    const server = await start();

    const answer = await take(server, { token: "nope" });

    expect(answer.status).toBe(401);
  });

  it("площадка берётся из приглашения", async () => {
    const server = await start();
    server.addInvite({ joinUrl: "https://ktalk.ru/room/abc", platform: "kontur" });

    const { body } = await take(server);

    expect((body.invites as { platform: string }[])[0]?.platform).toBe("kontur");
  });
});

describe("приглашение в meeting-claim", () => {
  it("верное приглашение — встреча заведена, приглашение погашено", async () => {
    const server = await start(true);
    const invite = server.addInvite({ joinUrl: MEET });

    const { status } = await claim(server, manual(invite.id, `${MEET}?hl=en`));

    expect(status).toBe(200);
    expect(server.inviteState(invite.id)).toEqual({ taken: false, used: true });
  });

  it("погашенное второй раз не проходит", async () => {
    const server = await start(true);
    const invite = server.addInvite({ joinUrl: MEET });
    await claim(server, manual(invite.id));

    const again = await claim(server, { ...manual(invite.id), identity_key: "scriba:other" });

    expect(again.status).toBe(403);
    expect(again.body.error).toMatch(/used/u);
  });

  it.each([
    ["неизвестное", (id: string): Record<string, unknown> => manual(`${id}-x`), /not_found/u],
    [
      "другая комната",
      (id: string): Record<string, unknown> => manual(id, "https://meet.google.com/zzz-zzzz-zzz"),
      /link_mismatch/u,
    ],
    [
      "ссылка не URL",
      (id: string): Record<string, unknown> => manual(id, "not a link"),
      /link_mismatch/u,
    ],
  ])("%s приглашение — 403", async (_name, body, reason) => {
    const server = await start(true);
    const invite = server.addInvite({ joinUrl: MEET });

    const answer = await claim(server, body(invite.id));

    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(reason);
    expect(server.inviteState(invite.id)).toEqual({ taken: false, used: false });
  });

  it("приглашение другого человека — 403", async () => {
    const server = await start(true);
    const invite = server.addInvite({ joinUrl: MEET, invitedBy: PERSON + 1 });

    const answer = await claim(server, manual(invite.id));

    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatch(/other_person/u);
  });

  it("истёкшее — 403", async () => {
    const server = await start(true);
    const invite = server.addInvite({ joinUrl: MEET, expiresInMs: -1 });

    const answer = await claim(server, manual(invite.id));

    expect(answer.body.error).toMatch(/expired/u);
  });

  it("со строгим двойником ручная заявка без приглашения — 403, календарная — как раньше", async () => {
    const server = await start(true);

    const bare = await claim(server, { identity_kind: "manual", identity_key: "scriba:1" });
    const calendar = await claim(server, { identity_kind: "calendar", identity_key: "k" });

    expect(bare.status).toBe(403);
    expect(bare.body.error).toMatch(/needs a valid invite/u);
    expect(calendar.status).toBe(200);
  });

  it("без строгости ручная заявка без приглашения проходит, как прежде", async () => {
    const server = await start(false);

    const bare = await claim(server, { identity_kind: "manual", identity_key: "scriba:1" });

    expect(bare.status).toBe(200);
  });

  it("приглашение сверяется и без строгости, раз оно предъявлено", async () => {
    const server = await start(false);

    const answer = await claim(server, manual("nobody"));

    expect(answer.status).toBe(403);
  });

  it("состояние неизвестного приглашения — ошибка, а не «не забрано»", async () => {
    const server = await start();

    expect(() => server.inviteState("nope")).toThrow(/nope/u);
  });
});
