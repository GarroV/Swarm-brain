/**
 * Тесты самого двойника `fake-swarm.ts`. Он оракул для всего блока `swarm-client`, поэтому каждое
 * правило приёмки здесь должно ловить сломанный вход и объяснять, чем именно он сломан — иначе
 * двойник будет молча пропускать то, что настоящий сервер отверг бы, и клиент пройдёт мимо бага.
 *
 * Живой HTTP на localhost (обычный `fetch`), без моков сети — так тест ловит расхождения в
 * заголовках и кодировке формы, которые мок бы не заметил.
 */
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { CurrentMeetingResponse } from "../contract.ts";
import { type FakeSwarm, type FakeSwarmOptions, startFakeSwarm } from "./fake-swarm.ts";

const TOKEN = "test-bot-token";
const ON_BEHALF_OF = "744230399";

const servers: FakeSwarm[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function launch(options?: FakeSwarmOptions): Promise<FakeSwarm> {
  const server = await startFakeSwarm(options);
  servers.push(server);
  return server;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "X-On-Behalf-Of": ON_BEHALF_OF, ...extra };
}

async function postJson(url: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

async function postForm(url: string, form: FormData): Promise<Response> {
  return fetch(url, { method: "POST", headers: authHeaders(), body: form });
}

function textFile(content: string, name = "part.m4a"): File {
  return new File([content], name, { type: "audio/m4a" });
}

describe("авторизация — общая для всех пяти эндпоинтов", () => {
  it("401, если Authorization не задан", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-current`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "bad token" });
  });

  it("403, если токен верный, но нет X-On-Behalf-Of", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-current`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "service agent token grants nothing on its own — send X-On-Behalf-Of",
    });
  });

  it("403, если X-On-Behalf-Of не тот, кого ждёт сервер", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-current`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "X-On-Behalf-Of": "1" },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "user not in agent workspace" });
  });
});

describe("meeting-current", () => {
  it("отдаёт заданный в options.current ответ", async () => {
    const current: CurrentMeetingResponse = { meeting: null, reason: "no_ongoing_event" };
    const fake = await launch({ current });
    const response = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(current);
  });
});

describe("url и port", () => {
  it("port — реальный эфемерный порт, url собран из него же", async () => {
    const fake = await launch();
    expect(fake.port).toBeGreaterThan(0);
    expect(fake.url).toBe(`http://127.0.0.1:${String(fake.port)}`);
  });
});

describe("meeting-claim", () => {
  it("отвечает 400 без identity_kind/identity_key", async () => {
    const fake = await launch();
    const response = await postJson(`${fake.url}/meeting-claim`, {});
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "identity_kind/identity_key required",
    });
  });

  it("отвечает 400, если identity_kind валиден, а identity_key нет", async () => {
    const fake = await launch();
    const response = await postJson(`${fake.url}/meeting-claim`, { identity_kind: "calendar" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "identity_kind/identity_key required",
    });
  });

  it("отвечает 400, если тело — не объект вовсе (например, null)", async () => {
    const fake = await launch();
    const response = await postJson(`${fake.url}/meeting-claim`, null);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "identity_kind/identity_key required",
    });
  });

  it("невалидный JSON в теле разбирается как пустой объект — 400, а не падение сервера", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-claim`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{not valid json",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "identity_kind/identity_key required",
    });
  });

  it("возвращает transcribe, а после setDecision('defer') — defer с held_by", async () => {
    const fake = await launch();
    const claimBody = { identity_kind: "calendar", identity_key: "evt-1:2026-09-23" };

    const first = await postJson(`${fake.url}/meeting-claim`, claimBody);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      meeting_id: "m-evt-1:2026-09-23",
      decision: "transcribe",
      lease_ttl_sec: 3600,
      held_by: null,
      held_by_name: null,
    });

    fake.setDecision("defer");
    const second = await postJson(`${fake.url}/meeting-claim`, claimBody);
    await expect(second.json()).resolves.toEqual({
      meeting_id: "m-evt-1:2026-09-23",
      decision: "defer",
      lease_ttl_sec: 3600,
      held_by: 111_111,
      held_by_name: "other",
    });
  });
});

describe("meeting-ingest — успешный приём", () => {
  it("принимает один sys_0 и записывает имя/offset/содержимое", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "meeting-1");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    form.set("sys_0", textFile("hello system audio"));

    const response = await postForm(`${fake.url}/meeting-ingest`, form);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      meeting_id: "meeting-1",
      web_url: "https://swarm.example/?meeting=meeting-1",
      summary_status: "processing",
    });

    expect(fake.ingested).toHaveLength(1);
    const record = fake.ingested[0];
    expect(record).toEqual({
      meeting_id: "meeting-1",
      sys: [
        {
          name: "sys_0",
          offset: 0,
          bytes: Buffer.byteLength("hello system audio"),
          content: "hello system audio",
        },
      ],
      mic: [],
    });
    expect(record).not.toHaveProperty("speakers");
  });

  it("разбирает необязательное поле speakers, когда оно есть", async () => {
    const fake = await launch();
    const speakers = [{ start: 0, end: 5, name: "Аня" }];
    const form = new FormData();
    form.set("meeting_id", "meeting-2");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    form.set("sys_0", textFile("audio"));
    form.set("speakers", JSON.stringify(speakers));

    const response = await postForm(`${fake.url}/meeting-ingest`, form);

    expect(response.status).toBe(202);
    expect(fake.ingested[0]?.speakers).toEqual(speakers);
  });

  it("speakers: невалидный JSON отклоняется отдельным правилом", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "meeting-3");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    form.set("sys_0", textFile("audio"));
    form.set("speakers", "not json");

    const response = await postForm(`${fake.url}/meeting-ingest`, form);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "speakers: invalid JSON" });
  });

  it("speakers: валидный JSON, но не массив — тоже отклоняется", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "meeting-4");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    form.set("sys_0", textFile("audio"));
    form.set("speakers", JSON.stringify({ start: 0, end: 5, name: "Аня" }));

    const response = await postForm(`${fake.url}/meeting-ingest`, form);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "speakers: invalid JSON" });
  });

  it("тело без multipart-границы отклоняется как «expected multipart/form-data»", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-ingest`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "multipart/form-data" }), // без boundary — не разобрать
      body: "meeting_id=m1",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "expected multipart/form-data with meeting_id + audio",
    });
  });
});

describe("meeting-ingest — правила манифеста (каждое падает на сломанном входе)", () => {
  it("400 без meeting_id", async () => {
    const fake = await launch();
    const form = new FormData();
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "meeting_id required" });
  });

  it("400 без единой части ни в одной дорожке", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "audio required (sys_parts/mic_parts manifest or legacy audio field)",
    });
  });

  it("400 на невалидный JSON манифеста", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", "{not json");
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "sys_parts: invalid JSON manifest",
    });
  });

  it("400, если манифест не массив", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify({ name: "sys_0" }));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "sys_parts: manifest must be an array",
    });
  });

  it("400, если у элемента манифеста нет name", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify([{ offset: 0 }]));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "sys_parts: part name required",
    });
  });

  it("400 на повторное имя части", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set(
      "sys_parts",
      JSON.stringify([
        { name: "sys_0", offset: 0 },
        { name: "sys_0", offset: 1 },
      ]),
    );
    form.set("sys_0", textFile("a"));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'sys_parts: duplicate part name "sys_0"',
    });
  });

  it("400 на отрицательный offset", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: -1 }]));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'sys_parts: bad offset for "sys_0"',
    });
  });

  it("400, если файл из манифеста не приложен", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'sys_parts: file "sys_0" missing',
    });
  });

  it("400, если приложенный файл пустой", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    form.set("sys_0", new File([], "sys_0.m4a", { type: "audio/m4a" }));
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'sys_parts: file "sys_0" empty',
    });
  });

  it("413, если файл больше 25MB", async () => {
    const fake = await launch();
    const form = new FormData();
    form.set("meeting_id", "m1");
    form.set("sys_parts", JSON.stringify([{ name: "sys_0", offset: 0 }]));
    // Один Uint8Array на 26MB, без дублей в памяти — просто оборачиваем его в Blob с именем файла.
    form.set("sys_0", new Blob([new Uint8Array(26 * 1024 * 1024)]), "sys_0.m4a");
    const response = await postForm(`${fake.url}/meeting-ingest`, form);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'part "sys_0" too large (>25MB)',
    });
  }, 10_000);
});

describe("meeting-heartbeat", () => {
  it("отвечает {ok: true} и пишет тело в requests", async () => {
    const fake = await launch();
    const payload = { recording: true, version: 3, on_call: true };
    const response = await postJson(`${fake.url}/meeting-heartbeat`, payload);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fake.requests.at(-1)?.body).toEqual(payload);
  });
});

describe("meeting-status", () => {
  it("отдаёт только id, заданные через setStatus", async () => {
    const fake = await launch();
    fake.setStatus("a", { summary_status: "done", status: "in_base" });
    const response = await fetch(`${fake.url}/meeting-status?ids=a,b`, { headers: authHeaders() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      statuses: [{ id: "a", summary_status: "done", status: "in_base" }],
    });
  });

  it("пустой ids отвечает пустым списком", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/meeting-status?ids=`, { headers: authHeaders() });
    await expect(response.json()).resolves.toEqual({ ok: true, statuses: [] });
  });
});

describe("failNext — имитация сбоя перед логикой", () => {
  it("первые N запросов отвечают заданным статусом, дальше пропускает", async () => {
    const fake = await launch();
    fake.failNext(2, 503);

    const first = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    const second = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    const third = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(third.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ ok: false, error: "injected" });
  });

  it("retryAfterSeconds добавляет заголовок Retry-After", async () => {
    const fake = await launch();
    fake.failNext(1, 503, { retryAfterSeconds: 7 });
    const response = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("7");
  });
});

describe("requestsTo и общий журнал requests", () => {
  it("requestsTo считает запросы к одному пути", async () => {
    const fake = await launch();
    await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    await postJson(`${fake.url}/meeting-heartbeat`, { recording: false, version: 1 });

    expect(fake.requestsTo("/meeting-current")).toHaveLength(2);
    expect(fake.requestsTo("/meeting-heartbeat")).toHaveLength(1);
  });

  it("неизвестный путь отвечает 404", async () => {
    const fake = await launch();
    const response = await fetch(`${fake.url}/does-not-exist`, { headers: authHeaders() });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "not found" });
  });
});

describe("живучесть — обрыв соединения не роняет сервер", () => {
  it("клиент, оборвавший тело запроса на середине, не мешает обработать следующий запрос", async () => {
    const fake = await launch();

    // Объявляем Content-Length больше того, что реально шлём, и рвём сокет на клиенте — сервер
    // должен поймать это как ошибку чтения тела (readRawBody), а не уронить процесс: иначе все
    // остальные тесты в этом файле тоже посыпались бы вместе с ним.
    await new Promise<void>((resolve) => {
      const socket = net.connect(fake.port, "127.0.0.1", () => {
        socket.write(
          "POST /meeting-heartbeat HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: 1000000\r\n" +
            "\r\n" +
            '{"partial":true',
        );
        socket.destroy();
      });
      socket.on("close", () => {
        // Дать серверу такт цикла событий, чтобы он успел обработать ECONNRESET на своей стороне.
        setTimeout(resolve, 50);
      });
    });

    const response = await fetch(`${fake.url}/meeting-current`, { headers: authHeaders() });
    expect(response.status).toBe(200);
  });
});
