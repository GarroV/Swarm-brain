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

  it("пустое тело там, где ответа не ждут, — не сбой", async () => {
    await expect(clientAnswering("").heartbeat({ recording: false, version: 1 })).resolves.toBe(
      undefined,
    );
  });
});

const MEETING = {
  identity_kind: "calendar",
  identity_key: "evt-1:2026-09-23",
  title: "Встреча",
  attendees: [{ name: "A", email: null }],
  started_at: "2026-09-23T10:00:00Z",
  ended_at: "2026-09-23T11:00:00Z",
  join_url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
};

function current(body: unknown): Promise<unknown> {
  return clientAnswering(JSON.stringify(body)).currentMeeting();
}

describe("meeting-current: форма проверяется на границе", () => {
  it("целая встреча проходит как есть", async () => {
    await expect(current({ meeting: MEETING })).resolves.toEqual({ meeting: MEETING });
  });

  it("встречи нет, причина названа — это ответ, а не сбой", async () => {
    await expect(current({ meeting: null, reason: "no_ongoing_event" })).resolves.toEqual({
      meeting: null,
      reason: "no_ongoing_event",
    });
  });

  it("ссылки нет, причина no_conference_link — проходит", async () => {
    const meeting = { ...MEETING, join_url: null, platform: null, reason: "no_conference_link" };
    await expect(current({ meeting })).resolves.toEqual({ meeting });
  });

  it("пустое тело — отказ: «встречи нет» так не говорят", async () => {
    await expect(clientAnswering("").currentMeeting()).rejects.toThrow(/нет поля meeting/u);
  });

  it("переименованное join_url — отказ, а не undefined ниже по цепочке", async () => {
    const renamed: Record<string, unknown> = { ...MEETING, joinUrl: MEETING.join_url };
    delete renamed.join_url;
    await expect(current({ meeting: renamed })).rejects.toThrow(/join_url/u);
  });

  it("незнакомая площадка — отказ, а не молчаливый null", async () => {
    await expect(current({ meeting: { ...MEETING, platform: "teams" } })).rejects.toThrow(
      /платформа|platform/u,
    );
  });

  it("ссылки нет, а площадка названа — противоречие, отказ", async () => {
    await expect(current({ meeting: { ...MEETING, join_url: null } })).rejects.toThrow(
      /противоречие/u,
    );
  });

  it("без identity_key — отказ: встречу не застолбить", async () => {
    await expect(current({ meeting: { ...MEETING, identity_key: "" } })).rejects.toThrow(
      /identity_key/u,
    );
  });

  it("attendees не список — отказ", async () => {
    await expect(current({ meeting: { ...MEETING, attendees: "A" } })).rejects.toThrow(
      /attendees/u,
    );
  });

  it("title не строка и не null — отказ", async () => {
    await expect(current({ meeting: { ...MEETING, title: 5 } })).rejects.toThrow(/title/u);
  });

  it("незнакомая причина отсутствия ссылки — отказ", async () => {
    const meeting = { ...MEETING, join_url: null, platform: null, reason: "no_link" };
    await expect(current({ meeting })).rejects.toThrow(/незнакомая причина/u);
  });

  it("reason верхнего уровня не строка — отказ", async () => {
    await expect(current({ meeting: null, reason: 404 })).rejects.toThrow(/reason/u);
  });

  it("встреча не объект — отказ", async () => {
    await expect(current({ meeting: "m-1" })).rejects.toThrow(/meeting/u);
  });
});

const PART = { name: "sys_0", offset: 0, body: new Blob(["x"]) };
const INGESTED = {
  ok: true,
  meeting_id: "m-1",
  web_url: "https://swarm.example/?meeting=m-1",
  summary_status: "processing",
};

function ingest(body: unknown): Promise<unknown> {
  return clientAnswering(JSON.stringify(body), 202).ingest({ meetingId: "m-1", system: [PART] });
}

describe("meeting-ingest: форма проверяется на границе", () => {
  it("целый ответ проходит как есть", async () => {
    await expect(ingest(INGESTED)).resolves.toEqual(INGESTED);
  });

  it("пустой web_url законен: сервер без WEB_BASE_URL так и отвечает", async () => {
    await expect(ingest({ ...INGESTED, web_url: "" })).resolves.toEqual({
      ...INGESTED,
      web_url: "",
    });
  });

  it("ok не true — отказ, а не «принято»", async () => {
    await expect(ingest({ ...INGESTED, ok: false })).rejects.toThrow(/ok/u);
  });

  it("без meeting_id — отказ", async () => {
    await expect(ingest({ ...INGESTED, meeting_id: undefined })).rejects.toThrow(/meeting_id/u);
  });

  it("переименованное summary_status — отказ", async () => {
    const renamed: Record<string, unknown> = { ...INGESTED, summaryStatus: "processing" };
    delete renamed.summary_status;
    await expect(ingest(renamed)).rejects.toThrow(/summary_status/u);
  });

  it("web_url не строка — отказ", async () => {
    await expect(ingest({ ...INGESTED, web_url: 7 })).rejects.toThrow(/web_url/u);
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
