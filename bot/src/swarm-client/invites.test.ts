/**
 * Клиент `POST /meeting-invite` — вход оркестратора в ручной запуск бота (решение D017).
 *
 * Ошибка здесь стоит встречи: приглашение сервер отдаёт ровно один раз, поэтому потерянное
 * при разборе приглашение уже не вернётся — бот не придёт, а человек будет ждать. Отсюда
 * правила: без подмены личности (дверь агента её отвергает), без повторов (повтор после
 * потерянного ответа ничего не вернёт, а второй забор — не идемпотентен), кривое приглашение
 * не роняет соседние в той же пачке.
 */
import { afterEach, describe, expect, it } from "vitest";

import { SwarmHttpError, SwarmProtocolError, SwarmTransportError } from "./errors.ts";
import { InviteClient, parseTakenInvites } from "./invites.ts";
import { type FakeSwarm, startFakeSwarm } from "./testing/fake-swarm.ts";

const TOKEN = "invite-token";
const PERSON = 744_230_399;

const valid = {
  id: "inv-1",
  invited_by: PERSON,
  join_url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
  created_at: "2026-09-26T10:00:00.000Z",
  expires_at: "2026-09-26T10:15:00.000Z",
};

const servers: FakeSwarm[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

async function startFake(): Promise<FakeSwarm> {
  const server = await startFakeSwarm({ token: TOKEN, onBehalfOf: PERSON });
  servers.push(server);
  return server;
}

describe("InviteClient против двойника сервера", () => {
  it("забирает приглашения токеном агента и БЕЗ X-On-Behalf-Of", async () => {
    const server = await startFake();
    const added = server.addInvite({ joinUrl: "https://meet.google.com/abc-defg-hij" });

    const taken = await new InviteClient({ baseUrl: server.url, token: TOKEN }).take();

    expect(taken.malformed).toEqual([]);
    expect(taken.invites.map((invite) => invite.id)).toEqual([added.id]);
    expect(taken.invites[0]?.invited_by).toBe(PERSON);
    const [request] = server.requestsTo("/meeting-invite");
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.onBehalfOf).toBeNull();
  });

  it("передаёт limit в теле", async () => {
    const server = await startFake();

    await new InviteClient({ baseUrl: server.url, token: TOKEN }).take(3);

    expect(server.requestsTo("/meeting-invite")[0]?.body).toEqual({ limit: 3 });
  });

  it("отказ сервера — SwarmHttpError со статусом, а не пустой список", async () => {
    const server = await startFake();

    const client = new InviteClient({ baseUrl: server.url, token: "not-the-token" });

    await expect(client.take()).rejects.toMatchObject({ status: 401 });
    await expect(client.take()).rejects.toBeInstanceOf(SwarmHttpError);
  });

  it("не повторяет запрос: второй забор после сбоя не вернёт уже отданное", async () => {
    const server = await startFake();
    server.failNext(1, 503);

    await expect(new InviteClient({ baseUrl: server.url, token: TOKEN }).take()).rejects.toThrow(
      SwarmHttpError,
    );
    expect(server.requests).toHaveLength(1);
  });

  it("сеть недоступна — SwarmTransportError", async () => {
    const server = await startFake();
    const { url } = server;
    await server.close();

    await expect(new InviteClient({ baseUrl: url, token: TOKEN }).take()).rejects.toBeInstanceOf(
      SwarmTransportError,
    );
  });

  it("ответ не JSON — громкий отказ", async () => {
    const client = new InviteClient({
      baseUrl: "https://swarm.example/functions/v1/",
      token: TOKEN,
      fetch: (): Promise<Response> => Promise.resolve(new Response("<html>502</html>")),
    });

    await expect(client.take()).rejects.toBeInstanceOf(SwarmProtocolError);
  });

  it("ходит по адресу <baseUrl>/meeting-invite, срезав хвостовой слэш", async () => {
    const seen: string[] = [];
    const client = new InviteClient({
      baseUrl: "https://swarm.example/functions/v1//",
      token: TOKEN,
      fetch: (input): Promise<Response> => {
        seen.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(Response.json({ ok: true, invites: [] }));
      },
    });

    await client.take();

    expect(seen).toEqual(["https://swarm.example/functions/v1/meeting-invite"]);
  });
});

describe("parseTakenInvites", () => {
  it("целое приглашение проходит как есть", () => {
    expect(parseTakenInvites({ ok: true, invites: [valid] })).toEqual({
      invites: [valid],
      malformed: [],
    });
  });

  it.each([
    ["не объект", null],
    ["ok не true", { ok: false, invites: [] }],
    ["нет списка invites", { ok: true }],
    ["invites не массив", { ok: true, invites: {} }],
  ])("%s — SwarmProtocolError", (_name, body) => {
    expect(() => parseTakenInvites(body)).toThrow(SwarmProtocolError);
  });

  it.each([
    ["без id", { ...valid, id: "" }, /id/u],
    ["invited_by не число", { ...valid, invited_by: "744230399" }, /invited_by/u],
    ["invited_by не целое", { ...valid, invited_by: 1.5 }, /invited_by/u],
    ["invited_by ноль", { ...valid, invited_by: 0 }, /invited_by/u],
    [
      "join_url не https",
      { ...valid, join_url: ["http", "://meet.google.com/abc"].join("") },
      /join_url/u,
    ],
    ["без площадки", { ...valid, platform: "" }, /platform/u],
    ["без created_at", { ...valid, created_at: undefined }, /created_at/u],
    ["без expires_at", { ...valid, expires_at: 7 }, /expires_at/u],
    ["не объект", "inv-2", /не объект/u],
  ])("%s — кривое откладывается с причиной, соседи проходят", (_name, broken, reason) => {
    const parsed = parseTakenInvites({ ok: true, invites: [broken, valid] });

    expect(parsed.invites).toEqual([valid]);
    expect(parsed.malformed).toHaveLength(1);
    expect(parsed.malformed[0]).toMatch(reason);
    expect(parsed.malformed[0]).toMatch(/invites\[0\]/u);
  });

  it("в причине есть id кривого приглашения, если он читается", () => {
    const parsed = parseTakenInvites({ ok: true, invites: [{ ...valid, invited_by: null }] });

    expect(parsed.malformed[0]).toContain("inv-1");
  });
});
