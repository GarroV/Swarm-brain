/**
 * Клиент meeting-notice: форма запроса по контракту notices и разбор каждого исхода.
 */
import { describe, expect, it } from "vitest";

import { NoticeClient } from "./notice-client.ts";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function clientAnswering(status: number, body: string): { client: NoticeClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = new NoticeClient({
    baseUrl: "https://swarm.example/functions/v1/",
    token: "bot-token",
    onBehalfOf: 744,
    fetch: (input, init): Promise<Response> => {
      sent.push({
        url: input as string,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(init?.body as string),
      });
      return Promise.resolve(new Response(body, { status }));
    },
  });
  return { client, sent };
}

const DELIVERED = JSON.stringify({
  ok: true,
  delivered: true,
  attempt: 1,
  should_leave: false,
  next_reminder_in_s: 180,
});

describe("запрос", () => {
  it("встречная нотиса: meeting_id, токен и за кого — без attempt и без получателя в теле", async () => {
    const { client, sent } = clientAnswering(200, DELIVERED);

    await client.notify({ kind: "door_waiting", meetingId: "m-1" });

    expect(sent[0]?.url).toBe("https://swarm.example/functions/v1/meeting-notice");
    expect(sent[0]?.headers).toMatchObject({
      Authorization: "Bearer bot-token",
      "X-On-Behalf-Of": "744",
    });
    expect(sent[0]?.body).toEqual({ kind: "door_waiting", meeting_id: "m-1" });
  });

  it("деталь уходит полем detail", async () => {
    const { client, sent } = clientAnswering(200, DELIVERED);

    await client.notify({ kind: "join_failed", meetingId: "m-1", detail: "net::ERR" });

    expect(sent[0]?.body).toEqual({ kind: "join_failed", meeting_id: "m-1", detail: "net::ERR" });
  });

  it("до-встречная нотиса: meeting_key и своё title", async () => {
    const { client, sent } = clientAnswering(200, DELIVERED);

    await client.notify({
      kind: "no_conference_link",
      meetingKey: "evt:2026-09-26",
      title: "Weekly",
    });

    expect(sent[0]?.body).toEqual({
      kind: "no_conference_link",
      meeting_key: "evt:2026-09-26",
      title: "Weekly",
    });
  });

  it("до-встречная без title — поля нет", async () => {
    const { client, sent } = clientAnswering(200, DELIVERED);

    await client.notify({ kind: "no_owner", meetingKey: "evt:1" });

    expect(sent[0]?.body).toEqual({ kind: "no_owner", meeting_key: "evt:1" });
  });
});

describe("ответ", () => {
  it("доставлено — решение should_leave от сервера", async () => {
    const second = JSON.stringify({ ok: true, delivered: true, attempt: 2, should_leave: true });

    await expect(
      clientAnswering(200, DELIVERED).client.notify({ kind: "door_waiting", meetingId: "m" }),
    ).resolves.toEqual({
      delivered: true,
      shouldLeave: false,
    });
    await expect(
      clientAnswering(200, second).client.notify({ kind: "door_waiting", meetingId: "m" }),
    ).resolves.toEqual({
      delivered: true,
      shouldLeave: true,
    });
  });

  it("409 — потолок: не доставлено, но уходить пора", async () => {
    const { client } = clientAnswering(409, JSON.stringify({ ok: false, should_leave: true }));

    await expect(client.notify({ kind: "door_waiting", meetingId: "m" })).resolves.toEqual({
      delivered: false,
      shouldLeave: true,
    });
  });

  it.each([
    [502, '{"ok":false,"delivered":false,"error":"notice not delivered: 403"}'],
    [404, '{"ok":false,"error":"meeting not found — claim it first"}'],
    [503, "<html>gateway</html>"],
  ])("HTTP %i — громкий отказ с текстом сервера", async (status, body) => {
    const { client } = clientAnswering(status, body);

    await expect(client.notify({ kind: "captcha", meetingId: "m" })).rejects.toThrow(
      new RegExp(`HTTP ${String(status)}`, "u"),
    );
  });

  it.each([
    ["не JSON", "ok"],
    ["ok не true", '{"ok":false,"delivered":true,"should_leave":false}'],
    ["delivered не true", '{"ok":true,"delivered":false,"should_leave":false}'],
  ])("200, но %s — отказ, а не «доставлено»", async (_what, body) => {
    const { client } = clientAnswering(200, body);

    await expect(client.notify({ kind: "captcha", meetingId: "m" })).rejects.toThrow(
      /не той формы/u,
    );
  });

  it("200 без should_leave — отказ: решение двери не угадываем", async () => {
    const { client } = clientAnswering(200, '{"ok":true,"delivered":true}');

    await expect(client.notify({ kind: "door_waiting", meetingId: "m" })).rejects.toThrow(
      /should_leave/u,
    );
  });

  it("корень без хвостового слэша тоже работает", async () => {
    const sent: string[] = [];
    const client = new NoticeClient({
      baseUrl: "https://swarm.example/functions/v1",
      token: "t",
      onBehalfOf: 1,
      fetch: (input): Promise<Response> => {
        sent.push(input as string);
        return Promise.resolve(new Response(DELIVERED));
      },
    });

    await client.notify({ kind: "no_audio", meetingId: "m" });

    expect(sent).toEqual(["https://swarm.example/functions/v1/meeting-notice"]);
  });
});
