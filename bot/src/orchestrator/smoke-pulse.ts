/**
 * Сквозной смоук пульса (T071): НАСТОЯЩИЙ контейнер бота бьёт heartbeat в НАСТОЯЩУЮ функцию
 * `meeting-heartbeat` поверх локального Supabase, а НАСТОЯЩИЙ сторож `swarm-bot`
 * (`meetings_watchdog`) решает, писать ли человеку. Проверяется то, чего не видят ни юнит-тесты,
 * ни смоук оркестратора на двойнике: что пульс из живого контейнера ложится в строку встречи, что
 * смерть контейнера посреди встречи доходит до человека алертом, а штатный конец и перехват записи
 * рекордером — нет.
 *
 * Сценарии:
 *   end      — встреча записана и отдана → финальный удар гасит флаг → сторож молчит; удары несут
 *              записанные секунды и продлевают лиз (T155) — арбитраж видит запись бота, а не 0;
 *   death    — kill посреди записи → пульс замолк на recording:true → алерт EN+RU claim_owner;
 *   takeover — рекордер человека перехватывает встречу настоящим `meeting-claim` → удар бота 403
 *              not_claim_owner → контейнер уходит `superseded` без выгрузки → сторож молчит.
 *
 * Сервер собран из двух половин за прокси: `meeting-heartbeat` — настоящий (ради него смоук), всё
 * остальное (`meeting-current`/`-claim`/`-ingest`/`-status`) — двойник `fake-swarm`, `/meeting-notice`
 * отвечает сам прокси. Двойник выдаёт `meeting_id` вида `m-<ключ>`, поэтому прокси подменяет его на
 * uuid встречи, засеянной в базе под сценарий: иначе настоящему heartbeat некуда было бы писать.
 * Время тишины не ждём 10 минут: после проверки, что пульс замолк, `agent_last_seen_at` старится
 * на 15 минут запросом — ровно то, что сделали бы часы.
 *
 * Что нужно: локальный Supabase с накатанными миграциями (прод сюда не подставлять — смоук заводит и
 * удаляет строки), собранный образ бота, Docker, deno.
 *
 *   SMOKE_SUPABASE_URL, SMOKE_SERVICE_KEY — локальный контур (`supabase status -o env`);
 *   SMOKE_PORT_BASE  — начало диапазона из 10 портов, base..base+3 — сам контур (по умолчанию 4440):
 *                      +4 meeting-heartbeat, +5 meeting-claim, +6 fake-swarm, +7 прокси,
 *                      +8 swarm-bot, +9 поддельный Telegram;
 *   SCRIBA_SMOKE_IMAGE, SCRIBA_SMOKE_PROJECT, SCRIBA_SMOKE_STATE, SCRIBA_SMOKE_ONLY — как у
 *                      smoke-orchestrator.ts.
 *
 * Запуск: node bot/src/orchestrator/smoke-pulse.ts
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer, request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Docker from "dockerode";

import { startFakeSwarm } from "../swarm-client/testing/fake-swarm.ts";
import { DockerodeEngine } from "./docker-engine.ts";
import { DockerMeetingEgress } from "./egress.ts";
import { type ContainerExit, type ContainerId, LABEL, Orchestrator } from "./orchestrator.ts";

const ENGINE = new DockerodeEngine();
const BASE = Number(process.env.SMOKE_PORT_BASE ?? "4440");
const PORT = {
  hb: BASE + 4,
  claim: BASE + 5,
  fake: BASE + 6,
  proxy: BASE + 7,
  bot: BASE + 8,
  tg: BASE + 9,
};
const SUPABASE_URL = process.env.SMOKE_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SMOKE_SERVICE_KEY ?? "";
const PROJECT = process.env.SCRIBA_SMOKE_PROJECT ?? "scriba-pulse";
const IMAGE = process.env.SCRIBA_SMOKE_IMAGE ?? "scriba-orchestrator:dev";
const STATE = process.env.SCRIBA_SMOKE_STATE ?? "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = path.resolve(HERE, "../../../supabase/functions");
const CRON_SECRET = "smoke-cron-secret";
const EXIT_WAIT_MS = 120_000;

const RUN = randomInt(1e6);
const TOKEN = `pulse-bot-${String(RUN)}`;
const WS = `smoke-pulse-${String(RUN)}`;
const AGENT_ID = `scriba-pulse-${String(RUN)}`;
const PERSON = 930_000_000_000 + RUN * 10; // за него бот пишет встречи
const TAKER = PERSON + 1; // его bumblebee перехватывает встречу
const TAKER_TOKEN = `pulse-taker-${String(RUN)}`;
const MEET = "https://meet.google.com/abc-defg-hij";

interface SeededMeeting {
  readonly id: string;
  readonly title: string;
  readonly key: string;
}
const meetingFor = (scene: string): SeededMeeting => ({
  id: randomUUID(),
  title: `Pulse ${scene} ${String(RUN)}`,
  key: `cal:smoke-pulse-${scene}-${String(RUN)}`,
});
const MEETINGS = {
  end: meetingFor("end"),
  death: meetingFor("death"),
  takeover: meetingFor("takeover"),
};

const BASE_ENV: Record<string, string> = {
  SCRIBA_ALONE_MS: "6000",
  SCRIBA_POLL_MS: "1000",
  SCRIBA_SEGMENT_SECONDS: "3",
  SCRIBA_HEARTBEAT_MS: "3000",
  SCRIBA_DOOR_WAIT_MS: "4000",
  SCRIBA_DOOR_REPEAT_MS: "4000",
};
const SHORT_PAGE = "/app/src/orchestrator/fixtures/meeting.html";
const LONG_PAGE = "/app/src/orchestrator/fixtures/meeting-long.html";

const failures: string[] = [];
function check(isPassed: boolean, what: string, detail = ""): void {
  const line = detail === "" ? what : `${what} — ${detail}`;
  if (!isPassed) failures.push(line);
  console.log(`  ${isPassed ? "✔" : "✘"} ${line}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function until(ms: number, what: string, isDone: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await isDone()) return;
    await sleep(1000);
  }
  throw new Error(`${what}: не дождались за ${String(ms / 1000)} с`);
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// ── База ────────────────────────────────────────────────────────────────────────

async function rest(method: string, route: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${route}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route}: ${String(response.status)} ${text}`);
  return text === "" ? null : (JSON.parse(text) as unknown);
}

interface Pulse {
  readonly claim_owner: number | null;
  readonly agent_last_seen_at: string | null;
  readonly agent_last_recording: boolean | null;
  readonly recorded_seconds: number | null;
  readonly lease_expires_at: string | null;
}

async function pulseOf(meeting: SeededMeeting): Promise<Pulse | undefined> {
  const rows = (await rest(
    "GET",
    `meetings?id=eq.${meeting.id}&select=claim_owner,agent_last_seen_at,agent_last_recording,recorded_seconds,lease_expires_at`,
  )) as Pulse[];
  return rows[0];
}

async function agentSeenAt(): Promise<number> {
  const rows = (await rest("GET", `service_agents?id=eq.${AGENT_ID}&select=last_seen_at`)) as {
    last_seen_at: string | null;
  }[];
  return Date.parse(rows[0]?.last_seen_at ?? "");
}

/**
 * Лиз, с которым засеяны встречи: удар бота обязан сдвинуть его вперёд (T155).
 */
const seeded = { leaseMs: 0 };

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke pulse" }]);
  await rest("POST", "allowed_users", [
    { telegram_id: PERSON, group_id: WS, added_by: PERSON, recorder_token_hash: null },
    { telegram_id: TAKER, group_id: WS, added_by: TAKER, recorder_token_hash: sha256(TAKER_TOKEN) },
  ]);
  await rest("POST", "service_agents", [
    { id: AGENT_ID, name: "scriba", group_id: WS, token_hash: sha256(TOKEN) },
  ]);
  seeded.leaseMs = Date.now() + 30 * 60_000;
  const lease = new Date(seeded.leaseMs).toISOString();
  await rest(
    "POST",
    "meetings",
    Object.values(MEETINGS).map((meeting) => ({
      id: meeting.id,
      source: "scriba-smoke",
      identity_kind: "calendar",
      identity_key: meeting.key,
      group_id: WS,
      claim_owner: PERSON,
      lease_expires_at: lease,
      title: meeting.title,
    })),
  );
}

async function cleanup(): Promise<void> {
  const ids = Object.values(MEETINGS).map((meeting) => meeting.id);
  const steps = [
    `meetings?id=in.(${ids.join(",")})`,
    `service_agents?id=eq.${AGENT_ID}`,
    `allowed_users?telegram_id=in.(${String(PERSON)},${String(TAKER)})`,
    `workspaces?id=eq.${WS}`,
  ];
  for (const step of steps) {
    try {
      await rest("DELETE", step);
    } catch (error) {
      check(false, "уборка", String(error));
    }
  }
}

// ── Процессы: функции Deno и поддельный Telegram ────────────────────────────────

const inbox: { chat_id: number; text: string }[] = [];

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function startTelegram(): ReturnType<typeof createServer> {
  const server = createServer((incoming, response) => {
    void readBody(incoming).then((raw) => {
      if (incoming.url?.endsWith("/sendMessage") === true) {
        const body = JSON.parse(raw.toString("utf8") || "{}") as {
          chat_id?: unknown;
          text?: unknown;
        };
        inbox.push({
          chat_id: Number(body.chat_id),
          text: typeof body.text === "string" ? body.text : "",
        });
      }
      answer(response, 200, { ok: true, result: { message_id: inbox.length } });
    });
  });
  server.listen(PORT.tg, "127.0.0.1");
  return server;
}

const PRELOAD_SOURCE = `
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.telegram.org/")) {
    return real(url.replace("https://api.telegram.org", "http://127.0.0.1:__TG_PORT__"), init);
  }
  return real(input, init);
};`.replace("__TG_PORT__", () => String(PORT.tg));
const PRELOAD = "data:application/typescript," + encodeURIComponent(PRELOAD_SOURCE);

function spawnFunction(name: string, port: number, extra: string[] = []): ChildProcess {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- смоук на машине разработчика, deno из PATH
  return spawn("deno", ["run", "--allow-all", ...extra, path.join(FUNCTIONS, name, "index.ts")], {
    env: {
      ...process.env,
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${String(port)}`,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      TELEGRAM_BOT_TOKEN: "smoke-telegram-token",
      CRON_SECRET,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function waitPort(port: number): Promise<void> {
  await until(60_000, `порт ${String(port)}`, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`);
      await response.body?.cancel();
      return true;
    } catch {
      return false;
    }
  });
}

async function cron(): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(PORT.bot)}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cron-Secret": CRON_SECRET },
    body: JSON.stringify({ meetings_watchdog: true }),
  });
  await response.body?.cancel();
  return response.status;
}

// ── Прокси: настоящий heartbeat + двойник остального ────────────────────────────

/**
 * Какую засеянную встречу прокси подставляет в ответ claim — меняется от сценария к сценарию.
 */
const claimTarget = { meetingId: "" };

function forward(
  incoming: IncomingMessage,
  raw: Buffer,
  port: number,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      },
      (reply) => {
        void readBody(reply).then((body) => {
          resolve({
            status: reply.statusCode ?? 502,
            headers: { "content-type": "application/json" },
            body,
          });
        });
      },
    );
    upstream.on("error", reject);
    upstream.end(raw);
  });
}

async function route(
  incoming: IncomingMessage,
  raw: Buffer,
): Promise<{ status: number; body: Buffer }> {
  const url = incoming.url ?? "";
  if (url === "/meeting-notice")
    return { status: 200, body: Buffer.from('{"ok":true,"delivered":true}') };
  if (url.startsWith("/meeting-heartbeat")) {
    const reply = await forward(incoming, raw, PORT.hb);
    return { status: reply.status, body: reply.body };
  }
  const reply = await forward(incoming, raw, PORT.fake);
  if (url.startsWith("/meeting-claim") && reply.status === 200) {
    const parsed = JSON.parse(reply.body.toString("utf8")) as Record<string, unknown>;
    return {
      status: 200,
      body: Buffer.from(JSON.stringify({ ...parsed, meeting_id: claimTarget.meetingId })),
    };
  }
  return { status: reply.status, body: reply.body };
}

function startProxy(): ReturnType<typeof createServer> {
  const server = createServer((incoming, response) => {
    void readBody(incoming)
      .then(async (raw) => route(incoming, raw))
      .then((reply) => {
        response.writeHead(reply.status, { "Content-Type": "application/json" });
        response.end(reply.body);
      })
      .catch((error: unknown) => {
        answer(response, 502, { error: `прокси смоука: ${String(error)}` });
      });
  });
  server.listen(PORT.proxy, "127.0.0.1");
  return server;
}

// ── Сценарии ────────────────────────────────────────────────────────────────────

/**
 * Дождаться выхода контейнера, но не вечно: порча, при которой бот не уходит сам, обязана
 * краснеть, а не вешать смоук. Не дождались — контейнер снимается, сценарий падает.
 */
async function exitWithin(
  orchestrator: Orchestrator,
  id: ContainerId,
): Promise<ContainerExit | undefined> {
  const timeout = async (): Promise<"timeout"> => {
    await sleep(EXIT_WAIT_MS);
    return "timeout";
  };
  const exit = await Promise.race([orchestrator.whenExited(id), timeout()]);
  if (exit !== "timeout") return exit;
  try {
    await new Docker().getContainer(id).remove({ force: true });
  } catch {
    // уже снят — нам и нужно, чтобы его не было
  }
  throw new Error(
    `контейнер не вышел сам за ${String(EXIT_WAIT_MS / 1000)} с — снят принудительно`,
  );
}

function orchestratorFor(page: string): Orchestrator {
  return new Orchestrator({
    engine: ENGINE,
    egress: new DockerMeetingEgress({
      engine: ENGINE,
      project: PROJECT,
      image: IMAGE,
      swarmUrl: `http://host.docker.internal:${String(PORT.proxy)}`,
      log: (line) => {
        console.log(`    [egress] ${line}`);
      },
    }),
    project: PROJECT,
    image: IMAGE,
    leaseDirectory: path.join(STATE, "lease-pulse"),
    swarmUrl: `http://host.docker.internal:${String(PORT.proxy)}`,
    token: TOKEN,
    version: 1,
    notifierFor: () => ({
      notify: () => Promise.resolve({ delivered: true, shouldLeave: false }),
    }),
    log: (line) => {
      console.log(`    [orchestrator] ${line.split("\n", 1)[0] ?? ""}`);
    },
    extraEnv: { ...BASE_ENV, SCRIBA_SMOKE_MEET_PAGE: page },
  });
}

async function ourContainers(): Promise<string[]> {
  const found = await new Docker().listContainers({
    all: true,
    filters: { label: [`${LABEL.project}=${PROJECT}`] },
  });
  return found.map((info) => info.Id);
}

/**
Пульс идёт: флаг записи взведён и время удара сдвинулось хотя бы раз.
*/
async function pulseGoes(meeting: SeededMeeting): Promise<void> {
  const seen = new Set<string>();
  await until(90_000, "пульс из контейнера в строке встречи", async () => {
    const pulse = await pulseOf(meeting);
    if (pulse?.agent_last_recording === true && pulse.agent_last_seen_at !== null) {
      seen.add(pulse.agent_last_seen_at);
    }
    return seen.size >= 2;
  });
  check(true, "пульс из живого контейнера лёг в строку встречи: recording=true, удары идут");
}

/**
Состарить тишину и прогнать настоящий cron. Возвращает сообщения по этой встрече.
*/
async function watchdogAbout(meeting: SeededMeeting): Promise<{ chat_id: number; text: string }[]> {
  await rest("PATCH", `meetings?id=eq.${meeting.id}`, { agent_last_seen_at: minutesAgo(15) });
  const status = await cron();
  check(status === 200, "cron meetings_watchdog ответил 200", `HTTP ${String(status)}`);
  return inbox.filter((message) => message.text.includes(meeting.title));
}

async function sceneEnd(fake: Fake): Promise<void> {
  console.log("\n──── штатный конец: встреча записана → финальный удар гасит флаг → сторож молчит");
  const meeting = MEETINGS.end;
  claimTarget.meetingId = meeting.id;
  const orchestrator = orchestratorFor(SHORT_PAGE);
  await orchestrator.init();
  try {
    const before = fake.ingested.length;
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    await pulseGoes(meeting);
    const exit = await exitWithin(orchestrator, id);
    check(
      exit?.kind === "finished" && exit.outcome === "recorded",
      "контейнер вышел штатно, recorded",
      JSON.stringify(exit),
    );
    check(fake.ingested.length === before + 1, "запись отдана в meeting-ingest");
    const pulse = await pulseOf(meeting);
    check(
      pulse?.agent_last_recording === false,
      "финальный удар погасил флаг в строке встречи",
      JSON.stringify(pulse),
    );
    check(
      (pulse?.recorded_seconds ?? 0) > 0,
      "удары принесли записанные секунды в recorded_seconds — арбитраж видит запись, а не 0",
      JSON.stringify(pulse),
    );
    check(
      Date.parse(pulse?.lease_expires_at ?? "") > seeded.leaseMs,
      "удары продлили лиз права транскрибации",
      JSON.stringify({ pulse, seededLease: new Date(seeded.leaseMs).toISOString() }),
    );
    const alerts = await watchdogAbout(meeting);
    check(alerts.length === 0, "сторож не принял штатный конец за смерть", JSON.stringify(alerts));
  } finally {
    orchestrator.close();
  }
}

async function sceneDeath(): Promise<void> {
  console.log("\n──── смерть посреди встречи: пульс замолк на recording:true → алерт claim_owner");
  const meeting = MEETINGS.death;
  claimTarget.meetingId = meeting.id;
  const orchestrator = orchestratorFor(LONG_PAGE);
  await orchestrator.init();
  try {
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    await pulseGoes(meeting);
    await new Docker().getContainer(id).kill();
    const exit = await exitWithin(orchestrator, id);
    check(exit?.kind === "died", "оркестратор увидел смерть", JSON.stringify(exit));
    const atKill = await pulseOf(meeting);
    await sleep(9000); // три интервала heartbeat
    const later = await pulseOf(meeting);
    check(
      later?.agent_last_seen_at === atKill?.agent_last_seen_at &&
        later?.agent_last_recording === true,
      "после смерти пульс замолк и остался на recording:true",
      JSON.stringify({ atKill, later }),
    );
    const alerts = await watchdogAbout(meeting);
    check(
      alerts.length === 1 &&
        alerts[0]?.chat_id === PERSON &&
        alerts[0].text.includes("scriba stopped responding") &&
        alerts[0].text.includes("scriba перестал отвечать"),
      "сторож увидел смерть: алерт EN+RU тому, за кого бот писал",
      JSON.stringify(alerts),
    );
  } finally {
    orchestrator.close();
  }
}

async function takeOver(meeting: SeededMeeting): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${String(PORT.claim)}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAKER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      identity_kind: "calendar",
      identity_key: meeting.key,
      recorded_seconds: 3600,
    }),
  });
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

async function sceneTakeover(fake: Fake): Promise<void> {
  console.log(
    "\n──── перехват: рекордер человека забирает встречу → бот уходит superseded → сторож молчит",
  );
  const meeting = MEETINGS.takeover;
  claimTarget.meetingId = meeting.id;
  const orchestrator = orchestratorFor(LONG_PAGE);
  await orchestrator.init();
  try {
    const before = fake.ingested.length;
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    await pulseGoes(meeting);
    const taken = await takeOver(meeting);
    const takenAt = Date.now();
    check(
      taken.status === 200 && taken.decision === "transcribe" && taken.meeting_id === meeting.id,
      "настоящий meeting-claim отдал встречу рекордеру",
      JSON.stringify(taken),
    );
    const exit = await exitWithin(orchestrator, id);
    check(
      exit?.kind === "finished" && exit.outcome === "superseded",
      "контейнер ушёл сам с исходом superseded",
      JSON.stringify(exit),
    );
    check(fake.ingested.length === before, "выгрузки не было");
    const pulse = await pulseOf(meeting);
    check(
      pulse?.claim_owner === TAKER && pulse.agent_last_recording === false,
      "встреча за рекордером, флаг бота погашен",
      JSON.stringify(pulse),
    );
    check(
      (await agentSeenAt()) >= takenAt - 1000,
      "финальный удар без встречи освежил строку агента",
    );
    const alerts = await watchdogAbout(meeting);
    check(
      alerts.length === 0,
      "ни новому claim_owner, ни прежнему ложного алерта нет",
      JSON.stringify(alerts),
    );
  } finally {
    orchestrator.close();
  }
}

type Fake = Awaited<ReturnType<typeof startFakeSwarm>>;
const SCENES: Record<string, (fake: Fake) => Promise<void>> = {
  end: sceneEnd,
  death: async () => sceneDeath(),
  takeover: sceneTakeover,
};

async function runScenes(fake: Fake): Promise<void> {
  const selected = process.env.SCRIBA_SMOKE_ONLY ?? "";
  const names = selected === "" ? Object.keys(SCENES) : selected.split(",");
  for (const name of names) {
    const scene = SCENES[name];
    if (scene === undefined) {
      check(false, `сценарий «${name}» не существует`);
      continue;
    }
    try {
      await scene(fake);
    } catch (error) {
      check(
        false,
        `сценарий ${name} сорвался`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  await until(60_000, "контейнеры стенда убраны", async () => {
    const left = await ourContainers();
    return left.length === 0;
  });
  check(true, "после сценариев контейнеров стенда не осталось");
}

async function suite(): Promise<number> {
  if (SUPABASE_URL === "" || SERVICE_KEY === "" || STATE === "") {
    console.error(
      "КРАСНЫЙ: нет SMOKE_SUPABASE_URL / SMOKE_SERVICE_KEY / SCRIBA_SMOKE_STATE — смоук не выполнялся",
    );
    return 2;
  }
  const leftovers = await ourContainers();
  if (leftovers.length > 0) {
    console.error(`КРАСНЫЙ: на стенде ${PROJECT} уже есть контейнеры — сначала убрать`);
    return 2;
  }
  const telegram = startTelegram();
  const proxy = startProxy();
  const functions = [
    spawnFunction("meeting-heartbeat", PORT.hb),
    spawnFunction("meeting-claim", PORT.claim),
    spawnFunction("swarm-bot", PORT.bot, [`--preload=${PRELOAD}`]),
  ];
  const fake = await startFakeSwarm({ token: TOKEN, onBehalfOf: PERSON, port: PORT.fake });
  try {
    await seed();
    await Promise.all([waitPort(PORT.hb), waitPort(PORT.claim), waitPort(PORT.bot)]);
    await runScenes(fake);
  } finally {
    for (const child of functions) child.kill("SIGTERM");
    await fake.close();
    proxy.close();
    telegram.close();
    await cleanup();
  }
  console.log(
    failures.length === 0
      ? "\nИТОГ: зелёный"
      : `\nИТОГ: КРАСНЫЙ — ${String(failures.length)}:\n  ${failures.join("\n  ")}`,
  );
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await suite();
// Таймеры dockerode-потоков не должны держать процесс смоука.
// eslint-disable-next-line unicorn/no-process-exit -- смоук — CLI
process.exit();
