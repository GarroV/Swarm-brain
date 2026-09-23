/**
 * Живой прогон блока: настоящий HTTP на localhost, настоящие файлы на диске.
 *
 * Здесь проверяется то, из-за чего встреча теряется молча, а значит проверять это надо
 * запуском, а не чтением кода:
 *   - клиент ходит во все пять эндпоинтов и разбирает их ответы;
 *   - `defer` → аудио не уходит ВООБЩЕ (ни одного запроса к `meeting-ingest`);
 *   - обрыв сети → запись лежит на диске и уезжает после перезапуска процесса;
 *   - манифест `[{name, offset}]` совпадает с тем, что сервер действительно принимает;
 *   - таймлайн говорящих уезжает полем `speakers`, а его отсутствие ничему не мешает.
 */
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SwarmClient } from "./client.ts";
import type { ClaimRequest, SpeakerSpan } from "./contract.ts";
import { SwarmDeferredError } from "./errors.ts";
import { UploadQueue } from "./queue.ts";
import { RecordingSession } from "./session.ts";
import { type FakeSwarm, startFakeSwarm } from "./testing/fake-swarm.ts";

const TOKEN = "test-bot-token";
const ON_BEHALF_OF = 744_230_399;
/**
 * Порт для проверки обрыва сети: сервер надо поднять ДВАЖДЫ на одном адресе, поэтому
 * эфемерный не подходит. Взят из диапазона, закреплённого за этим блоком (4320-4329).
 */
const RESTART_PORT = 4321;

const IDENTITY: ClaimRequest = {
  identity_kind: "calendar",
  identity_key: "evt-1:2026-09-23",
  title: "Тестовая встреча",
  recorded_seconds: 0,
};

const part = (text: string): Blob => new Blob([text], { type: "audio/mp4" });

/**
 * Исход вызова, а не обрыв теста на первом же отказе: так утверждение «аудио не ушло»
 * проверяется даже тогда, когда ворота повели себя иначе, чем ожидалось.
 */
async function outcome(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    return "прошло";
  } catch (error) {
    return error;
  }
}

/**
 * Ретраи клиента в тестах спят нулями: проверяем поведение, а не терпение.
 */
function clientFor(fake: FakeSwarm, attempts = 1): SwarmClient {
  return new SwarmClient({
    baseUrl: fake.url,
    token: TOKEN,
    onBehalfOf: ON_BEHALF_OF,
    retry: { attempts, sleep: (): Promise<void> => Promise.resolve() },
  });
}

describe("клиент пяти эндпоинтов", () => {
  let fake: FakeSwarm;

  beforeEach(async () => {
    fake = await startFakeSwarm({ token: TOKEN, onBehalfOf: ON_BEHALF_OF });
  });

  afterEach(async () => {
    await fake.close();
  });

  it("meeting-current отдаёт ссылку на звонок и площадку", async () => {
    const response = await clientFor(fake).currentMeeting();

    expect(response.meeting?.join_url).toContain("https://");
    expect(response.meeting?.platform).toBe("meet");
  });

  it("каждый запрос несёт токен и того, за кого действует бот", async () => {
    await clientFor(fake).currentMeeting();

    const request = fake.requestsTo("/meeting-current")[0];
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.onBehalfOf).toBe(String(ON_BEHALF_OF));
  });

  it("meeting-claim разбирается в решение арбитража", async () => {
    const response = await clientFor(fake).claim(IDENTITY);

    expect(response.decision).toBe("transcribe");
    expect(response.meeting_id).toBe(`m-${IDENTITY.identity_key}`);
  });

  it("meeting-heartbeat принимает «бот жив»", async () => {
    await clientFor(fake).heartbeat({ recording: true, version: 1, on_call: true });

    expect(fake.requestsTo("/meeting-heartbeat")).toHaveLength(1);
  });

  it("meeting-status отдаёт статусы пачкой", async () => {
    fake.setStatus("m-1", { status: "in_base", summary_status: "done" });
    const statuses = await clientFor(fake).statuses(["m-1", "m-2"]);

    expect(statuses.get("m-1")?.status).toBe("in_base");
    expect(statuses.has("m-2")).toBe(false);
  });

  it("бот от чужого имени получает отказ, и клиент не повторяет его", async () => {
    const stranger = new SwarmClient({
      baseUrl: fake.url,
      token: TOKEN,
      onBehalfOf: 1,
      retry: { attempts: 3, sleep: (): Promise<void> => Promise.resolve() },
    });

    await expect(stranger.currentMeeting()).rejects.toMatchObject({ status: 403 });
    expect(fake.requestsTo("/meeting-current")).toHaveLength(1);
  });

  it("временный сбой повторяется, и запрос всё-таки проходит", async () => {
    fake.failNext(2, 503);

    await expect(clientFor(fake, 5).currentMeeting()).resolves.toBeDefined();
    expect(fake.requestsTo("/meeting-current")).toHaveLength(3);
  });
});

describe("очередь выгрузки", () => {
  let fake: FakeSwarm;
  let root: string;

  beforeEach(async () => {
    fake = await startFakeSwarm({ token: TOKEN, onBehalfOf: ON_BEHALF_OF });
    root = await mkdtemp(path.join(tmpdir(), "scriba-queue-"));
  });

  afterEach(async () => {
    await fake.close();
    await rm(root, { recursive: true, force: true });
  });

  it("части уезжают манифестом [{name, offset}], который сервер принимает", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть один"), 0);
    await queue.stagePart("m-1", part("часть два"), 900);
    await queue.seal("m-1", []);

    const result = await queue.drain();

    expect(result.uploaded).toEqual(["m-1"]);
    expect(fake.ingested[0]?.sys).toEqual([
      { name: "sys_0", offset: 0, bytes: Buffer.byteLength("часть один"), content: "часть один" },
      { name: "sys_1", offset: 900, bytes: Buffer.byteLength("часть два"), content: "часть два" },
    ]);
  });

  it("часть больше предела не уходит в очередь вовсе — отказ громкий и сразу", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    const huge = new Blob([new Uint8Array(26 * 1024 * 1024)]);

    await expect(queue.stagePart("m-1", huge, 0)).rejects.toThrow(/больше предела/u);
    expect(fake.requestsTo("/meeting-ingest")).toHaveLength(0);
  });

  it("незапечатанная встреча не выгружается: она ещё идёт", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);

    const result = await queue.drain();

    expect(result.uploaded).toEqual([]);
    expect(fake.requestsTo("/meeting-ingest")).toHaveLength(0);
  });

  it("постоянный сбой уводит запись в dead-letter, а не в бесконечные повторы", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);
    fake.failNext(1, 403);

    const result = await queue.drain();

    expect(result.deadLettered).toEqual(["m-1"]);
    expect(await readdir(path.join(root, "failed"))).toHaveLength(1);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(0);
  });

  it("успешная выгрузка бэкап не стирает: 202 ещё не «обработано»", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);

    await queue.drain();

    expect(await readdir(path.join(root, "pending"))).toHaveLength(1);
  });

  it("пустая часть в очередь не принимается", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });

    await expect(queue.stagePart("m-1", new Blob([]), 0)).rejects.toThrow(/пустая/u);
  });

  it("часть после finish не принимается: запись уже запечатана", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);

    await expect(queue.stagePart("m-1", part("ещё"), 900)).rejects.toThrow(/запечатана/u);
  });

  it("запечатать несуществующую встречу нельзя", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });

    await expect(queue.seal("m-нет", [])).rejects.toThrow(/не найдена/u);
  });

  it("пустая очередь — это пустой прогон, а не сбой", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });

    await expect(queue.drain()).resolves.toEqual({
      uploaded: [],
      retryable: [],
      deadLettered: [],
      released: [],
    });
  });

  it("бэкап старше потолка сметается — диск не растёт бесконечно", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);
    await queue.drain();

    const later = new UploadQueue({
      root,
      client: clientFor(fake),
      backupTtlMs: 1000,
      now: () => Date.now() + 2000,
    });
    await expect(later.sweepExpired()).resolves.toHaveLength(1);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(0);
  });

  it("посторонние файлы и битые ссылки в каталоге очереди не мешают", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    // `.DS_Store` рядом с папками встреч — обычное дело на macOS, а битая ссылка
    // остаётся от недочищенного бэкапа. Ни то, ни другое не повод уронить прогон.
    await writeFile(path.join(root, "pending", ".DS_Store"), "мусор");
    await symlink("/не-существует", path.join(root, "pending", "призрак"));

    await expect(queue.sweepExpired()).resolves.toEqual([]);
    await expect(queue.drain()).resolves.toMatchObject({ uploaded: [] });
  });

  it("сбой опроса статусов бэкап не трогает: лучше лишний файл, чем потерянная запись", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);
    await queue.drain();
    fake.setStatus("m-1", { status: "in_base" });
    fake.failNext(1, 500);

    const second = await queue.drain();

    expect(second.released).toEqual([]);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(1);
  });

  it("опубликованная в базу встреча отпускает свой бэкап", async () => {
    const queue = new UploadQueue({ root, client: clientFor(fake) });
    await queue.stagePart("m-1", part("часть"), 0);
    await queue.seal("m-1", []);
    await queue.drain();
    fake.setStatus("m-1", { status: "in_base" });

    const second = await queue.drain();

    expect(second.released).toEqual(["m-1"]);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(0);
  });
});

describe("обрыв сети", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "scriba-outage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("запись переживает обрыв и перезапуск процесса", async () => {
    const firstRun = await startFakeSwarm({
      token: TOKEN,
      onBehalfOf: ON_BEHALF_OF,
      port: RESTART_PORT,
    });
    const queue = new UploadQueue({ root, client: clientFor(firstRun) });
    await queue.stagePart("m-1", part("речь встречи"), 0);
    await queue.seal("m-1", [{ start: 0, end: 12.4, name: "Вера" }]);

    // Сеть пропала ровно между записью и выгрузкой — худший момент из возможных.
    await firstRun.close();
    const offline = await queue.drain();

    expect(offline.uploaded).toEqual([]);
    expect(offline.retryable).toEqual(["m-1"]);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(1);

    // Процесс перезапустили: новая очередь видит ту же папку и ту же незавершённую работу.
    const secondRun = await startFakeSwarm({
      token: TOKEN,
      onBehalfOf: ON_BEHALF_OF,
      port: RESTART_PORT,
    });
    try {
      const revived = new UploadQueue({ root, client: clientFor(secondRun) });
      const online = await revived.drain();

      expect(online.uploaded).toEqual(["m-1"]);
      expect(secondRun.ingested[0]?.sys[0]?.content).toBe("речь встречи");
      expect(secondRun.ingested[0]?.speakers).toEqual([{ start: 0, end: 12.4, name: "Вера" }]);
    } finally {
      await secondRun.close();
    }
  });
});

describe("сессия записи", () => {
  let fake: FakeSwarm;
  let root: string;

  beforeEach(async () => {
    fake = await startFakeSwarm({ token: TOKEN, onBehalfOf: ON_BEHALF_OF });
    root = await mkdtemp(path.join(tmpdir(), "scriba-session-"));
  });

  afterEach(async () => {
    await fake.close();
    await rm(root, { recursive: true, force: true });
  });

  function sessionFor(): RecordingSession {
    const client = clientFor(fake);
    return new RecordingSession({
      client,
      queue: new UploadQueue({ root, client }),
      claim: IDENTITY,
      version: 1,
    });
  }

  it("defer → аудио не отправляется вообще", async () => {
    fake.setDecision("defer");
    const session = sessionFor();

    await expect(session.claim()).resolves.toBe("defer");
    // Исход каждого вызова ловим, а не обрываем тест на первом же: главное утверждение
    // здесь — «запросов на выгрузку не было», и оно обязано проверяться даже тогда, когда
    // ворота повели себя иначе, чем ожидалось. Иначе снятые ворота красят тест по другой
    // причине, а сам факт отправки аудио так и остаётся непроверенным.
    const pushed = await outcome(session.pushAudioPart(part("речь"), 0));
    const finished = await outcome(session.finish([]));

    // Порядок утверждений — не вкусовщина: первым идёт то, ради чего вся проверка.
    expect(fake.requestsTo("/meeting-ingest")).toHaveLength(0);
    expect(pushed).toBeInstanceOf(SwarmDeferredError);
    expect(finished).toBeInstanceOf(SwarmDeferredError);
    expect(fake.ingested).toHaveLength(0);
    // И на диске тоже пусто: отклонённая запись не копится «на потом».
    await expect(readdir(path.join(root, "pending"))).rejects.toThrow();
  });

  it("часть до claim не принимается: заявиться нужно раньше, чем писать", async () => {
    await expect(sessionFor().pushAudioPart(part("речь"), 0)).rejects.toThrow(/claim не вызван/u);
  });

  it("transcribe → запись уезжает вместе с таймлайном говорящих", async () => {
    const session = sessionFor();
    const timeline: SpeakerSpan[] = [
      { start: 0, end: 12.4, name: "Вера" },
      { start: 12.4, end: 30, name: "Пётр" },
    ];

    await session.claim();
    expect(session.id).toBe(`m-${IDENTITY.identity_key}`);
    expect(session.claimDecision).toBe("transcribe");

    await session.pushAudioPart(part("речь встречи"), 0);
    await session.finish(timeline);

    expect(fake.ingested).toHaveLength(1);
    expect(fake.ingested[0]?.meeting_id).toBe(`m-${IDENTITY.identity_key}`);
    expect(fake.ingested[0]?.speakers).toEqual(timeline);
  });

  it("пустой таймлайн записи не мешает: поле просто не отправляется", async () => {
    const session = sessionFor();

    await session.claim();
    await session.pushAudioPart(part("речь встречи"), 0);
    await session.finish([]);

    expect(fake.ingested).toHaveLength(1);
    expect(fake.ingested[0]?.speakers).toBeUndefined();
  });

  it("heartbeat говорит, что бот на звонке и какую встречу видит", async () => {
    const session = sessionFor();
    await session.claim();

    await session.heartbeat();

    expect(fake.requestsTo("/meeting-heartbeat")[0]?.body).toMatchObject({
      recording: true,
      on_call: true,
      meeting_key: IDENTITY.identity_key,
    });
  });

  it("сбой выгрузки не теряет запись: она остаётся на диске до следующего прогона", async () => {
    const session = sessionFor();
    await session.claim();
    await session.pushAudioPart(part("речь встречи"), 0);
    fake.failNext(1, 503);

    await session.finish([]);

    expect(fake.ingested).toHaveLength(0);
    expect(await readdir(path.join(root, "pending"))).toHaveLength(1);
  });
});
