/**
 * Что клиент делает с ответом, которого не ждал.
 *
 * Это та половина работы, которую не показывает ни один живой прогон: сервер отвечает
 * успехом, а внутри — не то. Молчаливое умолчание здесь стоит дороже всего, поэтому на
 * каждый такой случай должен быть громкий отказ, а не «ну, значит, defer».
 */
import { describe, expect, it } from "vitest";
import { SwarmClient } from "./client.ts";
import { SwarmProtocolError } from "./errors.ts";

/**
 * Сервер, отвечающий ровно тем, что дали. Настоящий двойник здесь не нужен: проверяется
 * разбор ответа, а не переписка.
 */
function clientAnswering(body: string, status = 200): SwarmClient {
  return new SwarmClient({
    baseUrl: "https://swarm.example/functions/v1",
    token: "t",
    onBehalfOf: 1,
    retry: { attempts: 1, sleep: (): Promise<void> => Promise.resolve() },
    fetch: (): Promise<Response> =>
      Promise.resolve(
        new Response(body, { status, headers: { "Content-Type": "application/json" } }),
      ),
  });
}

describe("ответ не той формы", () => {
  it("не JSON — это отказ, а не пустой объект", async () => {
    await expect(
      clientAnswering("<html>502 Bad Gateway</html>").currentMeeting(),
    ).rejects.toBeInstanceOf(SwarmProtocolError);
  });

  it("незнакомое решение арбитража не читается как «транскрибируем»", async () => {
    const client = clientAnswering(JSON.stringify({ meeting_id: "m-1", decision: "maybe" }));

    await expect(client.claim({ identity_kind: "calendar", identity_key: "k" })).rejects.toThrow(
      /незнакомое decision/u,
    );
  });

  it("ответ без meeting_id — отказ: складывать аудио некуда", async () => {
    const client = clientAnswering(JSON.stringify({ decision: "transcribe" }));

    await expect(client.claim({ identity_kind: "calendar", identity_key: "k" })).rejects.toThrow(
      /нет meeting_id/u,
    );
  });

  it("статусы без списка — отказ, а не «ничего не опубликовано»", async () => {
    // Молчаливый пустой список означал бы «бэкап держим вечно» — и никто бы не узнал.
    await expect(clientAnswering(JSON.stringify({ ok: true })).statuses(["m-1"])).rejects.toThrow(
      /нет списка statuses/u,
    );
  });

  it("пустой список встреч даже не идёт на сервер", async () => {
    await expect(clientAnswering("{}").statuses([])).resolves.toEqual(new Map());
  });

  it("пустое тело ответа читается как пустой объект, а не как сбой", async () => {
    await expect(clientAnswering("").currentMeeting()).resolves.toEqual({});
  });
});

describe("отправка без аудио", () => {
  it("выгрузка без единой части не делается вовсе", async () => {
    const client = clientAnswering("{}");

    await expect(client.ingest({ meetingId: "m-1", system: [] })).rejects.toThrow(
      /нет ни одной части/u,
    );
  });
});
