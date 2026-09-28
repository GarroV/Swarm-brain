#!/usr/bin/env -S deno run --allow-all
// Смоук сторожа оборванной записи: настоящий heartbeat бота через настоящую функцию
// meeting-heartbeat → настоящий cron swarm-bot {meetings_watchdog:true} → что увидел бы человек
// в Telegram. Проверяется то, чего не видят юнит-тесты: запросы к живым таблицам
// (meetings.agent_last_*, service_agents, allowed_users, meeting_notices), условный сброс флага
// и сверка владения встречей в meeting-heartbeat (чужая встреча → 403).
//
// Главный сценарий D018: ОДИН агент пишет несколько встреч сразу, одна замолкает — алерт только
// по ней, остальные живы и не помечаются призраками.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять:
// смоук заводит, старит и удаляет строки.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Тот же cron гоняет и сторож встреч-призраков (#549): живая встреча бота старше 15 минут не
// должна помечаться 'failed', а замолчавшего бота и рекордера человека — должна, как раньше.
//
// Перехват (D019): рекордер человека через НАСТОЯЩИЙ meeting-claim отбирает у бота право на
// встречу → флаг пульса бота гаснет тем же UPDATE, удары бота получают 403 с причиной
// not_claim_owner, и новому claim_owner сторож не шлёт ложный алерт. Монотонность: опоздавший
// удар recording:true не перетирает более свежий.
//
// Перехват решает выгрузка (T160): заявка другого человека в meeting-claim ничего не отбирает —
// она становится претендентом, а право переходит, только когда настоящий meeting-ingest измерил
// выгруженное аудио сам (по содержимому файла, не по заголовку) и оно заметно полнее. Заявка
// «на час» с выгрузкой на десять минут встречу не получает.
//
// Арбитраж (T155): удар бота продлевает лиз и пишет recorded_seconds — рекордер с записью короче
// не отбирает у бота встречу, claim после истечения лиза из claim не считает живого бота
// брошенным, а заметно более полная запись перехватывает — но только у непишущего бота (D020):
// пока бот пишет (лиз действует и последний удар recording:true), чужая запись получает defer.
//
// Порты — от SMOKE_PORT_BASE (по умолчанию 4380, диапазон блока orchestrator/сторож; base..base+3
// — сам контур): base+4 — функция meeting-heartbeat, base+5 — функция meeting-claim, base+6 —
// функция meeting-ingest, base+8 — функция swarm-bot, base+9 — поддельные Telegram и OpenAI.
// swarm-bot и обработка встречи после выгрузки ходят в api.telegram.org и api.openai.com
// напрямую, поэтому fetch подменяется предзагрузкой (--preload) только для этих хостов:
// настоящим людям и в настоящий OpenAI ничего не уходит.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-watchdog-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

import { grantCache } from "./scriba-smoke-grants.ts";

import { ingestFormOf } from "./smoke-m4a.ts";
import type { Overrides } from "../supabase/functions/meeting-ingest/m4a-fixture.ts";

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4380");
const PORT_HB = PORT_BASE + 4;
const PORT_CLAIM = PORT_BASE + 5;
const PORT_INGEST = PORT_BASE + 6;
const BUCKET = "meeting-audio";
const PORT_BOT = PORT_BASE + 8;
const PORT_TG = PORT_BASE + 9;
const CRON_SECRET = "smoke-cron-secret";

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-wd-${RUN}`;
const OWNER = 920_000_000_000 + RUN * 10; // за него бот пишет встречу, которая оборвалась
const OWNER_NOTIFIED = OWNER + 1; // ему оркестратор уже прислал container_died
const OWNER_ALIVE = OWNER + 2; // его встречи (две) бот пишет прямо сейчас
const HUMAN_CRASH = OWNER + 3; // bumblebee замолчал посреди записи
const HUMAN_ALIVE = OWNER + 4; // bumblebee пишет, heartbeat свежий
const TAKER = OWNER + 5; // его bumblebee перехватывает у бота встречу более полной записью
const OWNER_LATE = OWNER + 6; // за него бот пишет встречу, на которую приходит опоздавший удар
const OWNER_ARB = OWNER + 7; // за него бот пишет встречи арбитража (T155)
const PEOPLE = [
  OWNER,
  OWNER_NOTIFIED,
  OWNER_ALIVE,
  HUMAN_CRASH,
  HUMAN_ALIVE,
  TAKER,
  OWNER_LATE,
  OWNER_ARB,
];
const TAKER_TOKEN = `taker-${RUN}`;
const FOREIGN_WS = `smoke-wd-foreign-${RUN}`; // чужой воркспейс: его встречу агент трогать не вправе

// Один агент на все встречи — ровно то, что прятало обрыв до D018: строка агента была общей.
const AGENT = { id: `scriba-wd-${RUN}`, token: `wd-${RUN}` };
const MEETING = {
  dead: { id: crypto.randomUUID(), title: "Weekly <sync>", owner: OWNER },
  notified: { id: crypto.randomUUID(), title: "Ретро", owner: OWNER_NOTIFIED },
  alive2: { id: crypto.randomUUID(), title: "Planning", owner: OWNER_ALIVE },
  alive: { id: crypto.randomUUID(), title: "Daily", owner: OWNER_ALIVE },
};
// Встреча в чужом воркспейсе: heartbeat в неё обязан получить 403 и ничего не записать.
const FOREIGN = { id: crypto.randomUUID(), owner: OWNER };
// Календарная встреча, которую бот пишет за OWNER, а рекордер TAKER перехватывает (D019).
const TAKEN = {
  id: crypto.randomUUID(),
  key: `cal:smoke-taken-${RUN}`,
  owner: OWNER,
};
// Арбитраж (T155): бот заявился до захода с 0 секунд 40 минут назад — лиз из claim истёк.
//   long  — бот пишет 40 минут; рекордер с 15 минутами не отбирает, с 62 минутами отбирает честно;
//   lease — бот пишет 2 минуты; claim рекордера с 1 минутой после истечения лиза из claim не
//           занимает встречу как брошенную: удар бота лиз продлил.
const ARB = {
  long: { id: crypto.randomUUID(), key: `cal:smoke-arb-long-${RUN}` },
  lease: { id: crypto.randomUUID(), key: `cal:smoke-arb-lease-${RUN}` },
  // Заявка сверх времени встречи (T159): держатель записал 55 минут, бот не пишет.
  cap: { id: crypto.randomUUID(), key: `cal:smoke-arb-cap-${RUN}` },
};
// Встреча арбитража началась раньше, чем бот заявился: рекордер человека пишет её с начала, и его
// заявка в 62 минуты должна укладываться во время встречи по часам сервера (claim-clock.ts).
const ARB_STARTED_MIN = 70;
// Встреча, в строку которой уже лёг более свежий удар, чем тот, что придёт опоздавшим.
const LATE = { id: crypto.randomUUID(), owner: OWNER_LATE };
const keyOf = (m: { id: string }) => `manual:${m.id}`;
// Пустые встречи без бота — для сторожа призраков. Встречи из MEETING тоже пустые и тоже старые.
const GHOST = {
  human: {
    id: crypto.randomUUID(),
    key: `cal:smoke-${RUN}`,
    ageMin: 40,
    transcript: null,
  },
  fresh: {
    id: crypto.randomUUID(),
    key: `cal:smoke-fresh-${RUN}`,
    ageMin: 3,
    transcript: null,
  },
  filled: {
    id: crypto.randomUUID(),
    key: `cal:smoke-filled-${RUN}`,
    ageMin: 40,
    transcript: "hello",
  },
};
const MEETING_AGE_MIN = 40;
const ALL_MEETING_IDS = [
  ...Object.values(MEETING),
  ...Object.values(GHOST),
  FOREIGN,
  TAKEN,
  LATE,
  ...Object.values(ARB),
].map((m) => m.id);
// Встречи, которые завёл сам meeting-claim (новая строка), — их id известен только из ответа.
const createdMeetingIds: string[] = [];
const meetingIdsToClean = () => [...ALL_MEETING_IDS, ...createdMeetingIds];

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function rest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text === "" ? null : JSON.parse(text);
}

async function storage(method: string, path: string, body?: unknown): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Части, которые meeting-ingest положил в Storage по встрече (вложенность — до одного уровня). */
async function storedParts(meetingId: string): Promise<string[]> {
  const list = async (prefix: string) => {
    const res = await storage("POST", `object/list/${BUCKET}`, { prefix, limit: 1000 });
    return res.ok ? await res.json() as Array<{ name: string; id: string | null }> : [];
  };
  const rows = await list(meetingId);
  const nested = await Promise.all(
    rows.filter((r) => r.id === null).map(async (dir) =>
      (await list(`${meetingId}/${dir.name}`)).map((f) => `${meetingId}/${dir.name}/${f.name}`)
    ),
  );
  return [...rows.filter((r) => r.id !== null).map((r) => `${meetingId}/${r.name}`), ...nested.flat()];
}

// ── Поддельный Telegram ─────────────────────────────────────────────────────────

const inbox: Array<{ chat_id: number; text: string }> = [];
function startTelegram(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT_TG,
    onListen: () => {},
  }, async (req) => {
    const path = new URL(req.url).pathname;
    // Обработка встречи после выгрузки перехватчика: поддельный Whisper и тезисы.
    if (path === "/v1/audio/transcriptions") {
      await req.body?.cancel();
      const segments = [{ start: 0, end: 9, text: "smoke takeover", no_speech_prob: 0.01, avg_logprob: -0.2 }];
      return Response.json({ text: "smoke takeover", language: "english", segments });
    }
    if (path === "/v1/chat/completions") {
      await req.body?.cancel();
      return Response.json({ choices: [{ message: { content: "- smoke" }, finish_reason: "stop" }] });
    }
    const body = await req.json().catch(() => ({}));
    if (path.endsWith("/sendMessage")) {
      inbox.push({
        chat_id: Number(body.chat_id),
        text: String(body.text ?? ""),
      });
    }
    return Response.json({ ok: true, result: { message_id: inbox.length } });
  });
}

// Предзагрузка для swarm-bot и meeting-ingest: api.telegram.org и api.openai.com → поддельный
// сервер. Больше ничего не трогает.
const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const host of ["https://api.telegram.org", "https://api.openai.com"]) {
    if (url.startsWith(host + "/")) return real(url.replace(host, "http://127.0.0.1:${PORT_TG}"), init);
  }
  return real(input, init);
};`)
}`;

function spawnFunction(
  path: string,
  port: number,
  extra: string[] = [],
): Deno.ChildProcess {
  return new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      ...extra,
      new URL(path, import.meta.url).pathname,
    ],
    env: {
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      TELEGRAM_BOT_TOKEN: "smoke-telegram-token",
      OPENAI_API_KEY: "smoke-openai-key",
      CRON_SECRET,
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

async function waitPort(port: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

// ── Засев и уборка ──────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  const bucket = await storage("POST", "bucket", { id: BUCKET, name: BUCKET, public: false });
  await bucket.body?.cancel(); // уже есть — 409, это нормально
  await rest("POST", "workspaces", [
    { id: WS, name: "Smoke watchdog" },
    { id: FOREIGN_WS, name: "Smoke foreign" },
  ]);
  await rest(
    "POST",
    "allowed_users",
    await Promise.all(PEOPLE.map(async (id) => ({
      telegram_id: id,
      group_id: WS,
      added_by: id,
      recorder_token_hash: id === TAKER ? await sha256Hex(TAKER_TOKEN) : null,
    }))),
  );
  await rest("POST", "service_agents", [{
    id: AGENT.id,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(AGENT.token),
  }]);
  await rest("POST", "meetings", [{
    id: FOREIGN.id,
    source: "scriba-smoke",
    identity_kind: "manual",
    identity_key: `manual:${FOREIGN.id}`,
    group_id: FOREIGN_WS,
    claim_owner: FOREIGN.owner,
    title: "Foreign",
    created_at: minutesAgo(3),
  }]);
  await rest(
    "POST",
    "meetings",
    Object.values(MEETING).map((m) => ({
      id: m.id,
      source: "scriba-smoke",
      identity_kind: "manual",
      identity_key: keyOf(m),
      group_id: WS,
      claim_owner: m.owner,
      title: m.title,
      created_at: minutesAgo(MEETING_AGE_MIN),
    })),
  );
  await rest("POST", "meetings", [{
    id: TAKEN.id,
    source: "scriba-smoke",
    identity_kind: "calendar",
    identity_key: TAKEN.key,
    group_id: WS,
    claim_owner: TAKEN.owner,
    lease_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    title: "Taken over",
    created_at: minutesAgo(MEETING_AGE_MIN),
  }, {
    id: LATE.id,
    source: "scriba-smoke",
    identity_kind: "manual",
    identity_key: keyOf(LATE),
    group_id: WS,
    claim_owner: LATE.owner,
    lease_expires_at: null,
    title: "Late beat",
    created_at: minutesAgo(3),
  }]);
  await rest(
    "POST",
    "meetings",
    Object.values(ARB).map((m) => ({
      id: m.id,
      source: "scriba-smoke",
      identity_kind: "calendar",
      identity_key: m.key,
      group_id: WS,
      claim_owner: OWNER_ARB,
      recorded_seconds: 0, // так заявляется бот до захода (claim-request.ts)
      lease_expires_at: minutesAgo(10), // выдан claim-ом 40 минут назад на 30
      title: "Arbitration",
      started_at: minutesAgo(ARB_STARTED_MIN),
      created_at: minutesAgo(MEETING_AGE_MIN),
    })),
  );
  await rest(
    "POST",
    "meetings",
    Object.values(GHOST).map((g) => ({
      id: g.id,
      source: "desktop-agent",
      identity_kind: "calendar",
      identity_key: g.key,
      group_id: WS,
      claim_owner: HUMAN_ALIVE,
      title: "Ghost",
      transcript: g.transcript,
      created_at: minutesAgo(g.ageMin),
    })),
  );
}

async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const parts = (await Promise.all(meetingIdsToClean().map(storedParts))).flat();
  if (parts.length > 0) {
    const res = await storage("DELETE", `object/${BUCKET}`, { prefixes: parts });
    if (!res.ok) problems.push(`storage: ${res.status} ${await res.text()}`);
    else await res.body?.cancel();
  }
  const steps: Array<[string, string]> = [
    [
      "DELETE",
      `meetings?id=in.(${meetingIdsToClean().join(",")})`,
    ], // notices и пропуска — каскадом
    ["DELETE", `meeting_agent_grants?group_id=eq.${WS}`],
    ["DELETE", `meeting_invites?group_id=eq.${WS}`],
    ["DELETE", `service_agents?id=eq.${AGENT.id}`],
    ["DELETE", `allowed_users?telegram_id=in.(${PEOPLE.join(",")})`],
    ["DELETE", `workspaces?id=in.(${WS},${FOREIGN_WS})`],
  ];
  for (const [method, path] of steps) {
    try {
      await rest(method, path);
    } catch (e) {
      problems.push(String(e));
    }
  }
  return problems;
}

// ── Сценарий ────────────────────────────────────────────────────────────────────

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

const grantFor = grantCache(rest, { agentId: AGENT.id, groupId: WS });

/** Удар бота по встрече — от имени onBehalfOf, как шлёт его контейнер (session.heartbeat). */
async function beat(
  meeting: { id: string },
  onBehalfOf: number,
): Promise<number> {
  return (await beatRaw(meeting, onBehalfOf)).status;
}

async function beatRaw(
  meeting: { id: string },
  onBehalfOf: number,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${PORT_HB}/`, {
    method: "POST",
    headers: {
      // Бот за человека ходит пропуском своей встречи (T165), а не токеном агента.
      Authorization: `Bearer ${await grantFor(onBehalfOf, meeting.id)}`,
      "X-On-Behalf-Of": String(onBehalfOf),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recording: true,
      version: 1,
      on_call: true,
      meeting_key: `manual:${meeting.id}`,
      meeting_id: meeting.id,
      ...extra,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Заявка bumblebee человека TAKER через настоящий meeting-claim: запись на час. */
async function takeOver(): Promise<
  { status: number; body: Record<string, unknown> }
> {
  const res = await fetch(`http://127.0.0.1:${PORT_CLAIM}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TAKER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity_kind: "calendar",
      identity_key: TAKEN.key,
      recorded_seconds: 3600,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Заявка bumblebee человека TAKER на встречу `key` с записью `seconds` — настоящий meeting-claim. */
async function claimAs(
  key: string,
  seconds: number,
): Promise<{ status: number; decision: unknown }> {
  const res = await fetch(`http://127.0.0.1:${PORT_CLAIM}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TAKER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity_kind: "calendar",
      identity_key: key,
      recorded_seconds: seconds,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    decision: (body as { decision?: unknown }).decision,
  };
}

/** Выгрузка рекордера TAKER в настоящий meeting-ingest: `seconds` аудио, измеримых сервером. */
async function uploadAs(
  meetingId: string,
  seconds: number,
  overrides: Overrides = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${PORT_INGEST}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAKER_TOKEN}` },
    body: ingestFormOf(meetingId, seconds, 900, overrides),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Роль TAKER в recorders встречи. */
async function takerRole(id: string): Promise<string | undefined> {
  const rows = await rest("GET", `meetings?id=eq.${id}&select=recorders`) as Array<{
    recorders: Array<{ telegram_id: number; role: string }> | null;
  }>;
  return (rows[0]?.recorders ?? []).find((r) => r.telegram_id === TAKER)?.role;
}

async function arbRow(id: string) {
  const rows = await rest(
    "GET",
    `meetings?id=eq.${id}&select=claim_owner,recorded_seconds,lease_expires_at,agent_last_recording`,
  );
  return (rows as Array<{
    claim_owner: number | null;
    recorded_seconds: number | null;
    lease_expires_at: string | null;
    agent_last_recording: boolean | null;
  }>)[0];
}

/** Арбитраж meeting-claim видит запись бота честно (T155). */
async function arbitration(): Promise<void> {
  // Удар бота на 40-й минуте записи: секунды в арбитраж, лиз продлён от удара.
  const hit = await beatRaw(ARB.long, OWNER_ARB, {
    recorded_seconds: 2400,
    version: 7,
  });
  const afterBeat = await arbRow(ARB.long.id);
  expect(
    "удар бота записал 2400 с и продлил лиз на 30 минут от удара",
    hit.status === 200 && afterBeat?.recorded_seconds === 2400 &&
      Date.parse(afterBeat?.lease_expires_at ?? "") > Date.now() + 29 * 60_000,
    JSON.stringify({ hit, afterBeat }),
  );
  const agent = await agentRow();
  expect(
    "строка агента освежена условной UPDATE (версия удара легла)",
    agent?.last_version === 7,
    JSON.stringify(agent),
  );

  // Рекордер с 15 минутами: до T155 отбирал (0 с у бота, 900 ≥ 300), теперь — defer.
  const short = await claimAs(ARB.long.key, 900);
  const afterShort = await arbRow(ARB.long.id);
  expect(
    "рекордер с записью короче не отбирает встречу у бота (defer, claim_owner прежний)",
    short.status === 200 && short.decision === "defer" &&
      afterShort?.claim_owner === OWNER_ARB &&
      afterShort?.agent_last_recording === true,
    JSON.stringify({ short, afterShort }),
  );

  // Рекордер с 62 минутами — заметно полнее 40 (×1.5 и +5 мин). Пока бот пишет — всё равно defer
  // (D020: перехват только у непишущего бота); бот закончил запись — арбитраж честный, не глухой.
  const fullWhileWriting = await claimAs(ARB.long.key, 3720);
  expect(
    "D020: даже заметно более полная запись другого человека не перехватывает у пишущего бота",
    fullWhileWriting.status === 200 && fullWhileWriting.decision === "defer" &&
      (await arbRow(ARB.long.id))?.claim_owner === OWNER_ARB,
    JSON.stringify(fullWhileWriting),
  );
  await beatRaw(ARB.long, OWNER_ARB, {
    recording: false,
    recorded_seconds: 2400,
  });
  // Бот закончил запись, заявка на 62 минуты — претендент: строка встречи не тронута, пока
  // сервер не измерил выгрузку. Выгружено 10 минут — отказ, право у бота; 62 минуты — перехват.
  const claimed = await claimAs(ARB.long.key, 3720);
  const afterClaim = await arbRow(ARB.long.id);
  expect(
    "T160: заявка заметно полнее — претендент (transcribe клиенту), право и лиз бота не тронуты",
    claimed.status === 200 && claimed.decision === "transcribe" &&
      afterClaim?.claim_owner === OWNER_ARB && afterClaim?.recorded_seconds === 2400 &&
      (await takerRole(ARB.long.id)) === "challenger",
    JSON.stringify({ claimed, afterClaim }),
  );
  // Длина — по содержимому: две секунды звука под заголовком на 62 минуты — не 62 минуты.
  const headerOnly = await uploadAs(ARB.long.id, 2, { mvhdSec: 3720 });
  const afterHeaderOnly = await arbRow(ARB.long.id);
  expect(
    "длина по содержимому: файл на 2 с с заголовком на 62 минуты — 409, право у бота",
    headerOnly.status === 409 && afterHeaderOnly?.claim_owner === OWNER_ARB &&
      afterHeaderOnly?.recorded_seconds === 2400 && (await takerRole(ARB.long.id)) === "defer",
    JSON.stringify({ headerOnly, afterHeaderOnly }),
  );
  const reclaimed = await claimAs(ARB.long.key, 3720);
  expect(
    "после отказа новая заявка снова делает претендентом",
    reclaimed.status === 200 && reclaimed.decision === "transcribe" &&
      (await takerRole(ARB.long.id)) === "challenger",
    JSON.stringify(reclaimed),
  );
  const short10 = await uploadAs(ARB.long.id, 600);
  const afterShortUpload = await arbRow(ARB.long.id);
  expect(
    "T160: заявлено 62 минуты, выгружено 10 — 409, право у бота, претендент стал defer",
    short10.status === 409 && afterShortUpload?.claim_owner === OWNER_ARB &&
      afterShortUpload?.recorded_seconds === 2400 && (await takerRole(ARB.long.id)) === "defer",
    JSON.stringify({ short10, afterShortUpload }),
  );
  expect(
    "T160: после отказа выгрузка без новой заявки не принимается (403)",
    (await uploadAs(ARB.long.id, 3720)).status === 403,
  );
  const full = await claimAs(ARB.long.key, 3720);
  const fullUpload = await uploadAs(ARB.long.id, 3720);
  const afterFull = await arbRow(ARB.long.id);
  expect(
    "бот закончил запись — выгрузка заметно полнее перехватывает (202, секунды измеренные, флаг бота погашен)",
    full.status === 200 && full.decision === "transcribe" && fullUpload.status === 202 &&
      afterFull?.claim_owner === TAKER && afterFull?.recorded_seconds === 3720 &&
      afterFull?.agent_last_recording === false && (await takerRole(ARB.long.id)) === "transcribe",
    JSON.stringify({ full, fullUpload, afterFull }),
  );

  // Лиз из claim истёк, но бот жив: удар продлил, и claim после 30 минут не берёт встречу как
  // брошенную. До T155 ветка «лиз истёк» отдала бы её рекордеру с одной минутой записи.
  await beatRaw(ARB.lease, OWNER_ARB, { recorded_seconds: 120 });
  const lease = await claimAs(ARB.lease.key, 60);
  const afterLease = await arbRow(ARB.lease.id);
  expect(
    "claim после истечения лиза из claim не считает живого бота истёкшим (defer)",
    lease.status === 200 && lease.decision === "defer" &&
      afterLease?.claim_owner === OWNER_ARB,
    JSON.stringify({ lease, afterLease }),
  );

  // Заявка сверх времени встречи (T159): встреча идёт 70 минут, держатель записал 55, бот не пишет.
  // Сутки в заявке урезаются до времени встречи и заметно полнее держателя уже не выходят — defer;
  // в строку и в recorders ложатся урезанные секунды, а не присланные.
  await rest("PATCH", `meetings?id=eq.${ARB.cap.id}`, {
    recorded_seconds: 3300,
    agent_last_recording: false,
    // Лиз держателя действует: истёкший лиз без стенограммы — брошенная встреча, её занимает любой.
    lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const capped = await claimAs(ARB.cap.key, 86_000);
  const capRows = await rest(
    "GET",
    `meetings?id=eq.${ARB.cap.id}&select=claim_owner,recorded_seconds,recorders,started_at`,
  ) as Array<{
    started_at: string;
    claim_owner: number | null;
    recorded_seconds: number | null;
    recorders: Array<{ telegram_id: number; recorded_seconds?: number }> | null;
  }>;
  const capRow = capRows[0];
  const takerEntry = (capRow?.recorders ?? []).find((r) => r.telegram_id === TAKER);
  expect(
    "заявка сверх времени встречи урезана и чужую запись не перехватывает (defer, секунды держателя целы)",
    capped.status === 200 && capped.decision === "defer" &&
      capRow?.claim_owner === OWNER_ARB && capRow?.recorded_seconds === 3300,
    JSON.stringify({ capped, capRow }),
  );
  const capSec = takerEntry?.recorded_seconds ?? Number.NaN;
  expect(
    "в recorders легли урезанные секунды заявки: не больше времени встречи с запасом",
    // Потолок — от started_at до момента заявки (×1.1 + 5 мин); «сейчас» позже заявки, поэтому
    // граница по нему не тесней настоящей, а время самого прогона до этой точки её не ломает.
    capSec > 0 && capSec <= ((Date.now() - Date.parse(capRow?.started_at ?? "")) / 1000) * 1.1 + 300,
    JSON.stringify(takerEntry),
  );

  // Новая строка (T160): у неё потолка по часам нет, первый заявитель сам ставит секунды. Сутки в
  // заявке закрывали бы встречу от перехвата — первая выгрузка держателя опускает секунды встречи
  // до измеренного.
  const fresh = await fetch(`http://127.0.0.1:${PORT_CLAIM}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAKER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ identity_kind: "manual", identity_key: `manual:smoke-fresh-${RUN}`, recorded_seconds: 86_000 }),
  });
  const freshBody = await fresh.json().catch(() => ({})) as { decision?: string; meeting_id?: string };
  if (typeof freshBody.meeting_id === "string") createdMeetingIds.push(freshBody.meeting_id);
  const freshId = freshBody.meeting_id ?? "";
  const freshUpload = freshBody.decision === "transcribe" ? await uploadAs(freshId, 600) : null;
  const afterFresh = await arbRow(freshId);
  expect(
    "T160: новая встреча с сутками в заявке — первая выгрузка держателя опускает секунды до измеренных",
    fresh.status === 200 && freshBody.decision === "transcribe" && freshUpload?.status === 202 &&
      afterFresh?.claim_owner === TAKER && afterFresh?.recorded_seconds === 600,
    JSON.stringify({ freshBody, freshUpload, afterFresh }),
  );

  // Негодные секунды — 400, в арбитраж не попадают.
  const bad = await beatRaw(ARB.lease, OWNER_ARB, { recorded_seconds: 90_000 });
  expect(
    "recorded_seconds сверх суток — 400, записанное не тронуто",
    bad.status === 400 &&
      (await arbRow(ARB.lease.id))?.recorded_seconds === 120,
    JSON.stringify(bad),
  );
}

async function claimOwner(id: string): Promise<number | null> {
  const rows = await rest("GET", `meetings?id=eq.${id}&select=claim_owner`);
  return (rows as Array<{ claim_owner: number | null }>)[0]?.claim_owner ??
    null;
}

async function agentRow() {
  const rows = await rest(
    "GET",
    `service_agents?id=eq.${AGENT.id}&select=last_seen_at,last_version`,
  );
  return (rows as Array<
    { last_seen_at: string | null; last_version: number | null }
  >)[0];
}

async function meetingBeat(id: string) {
  const rows = await rest(
    "GET",
    `meetings?id=eq.${id}&select=agent_last_seen_at,agent_last_recording`,
  );
  return (rows as Array<
    { agent_last_seen_at: string | null; agent_last_recording: boolean | null }
  >)[0];
}
async function humanRecording(id: number): Promise<boolean | null> {
  const rows = await rest(
    "GET",
    `allowed_users?telegram_id=eq.${id}&select=recorder_last_recording`,
  );
  return (rows as Array<{ recorder_last_recording: boolean | null }>)[0]
    ?.recorder_last_recording ?? null;
}

async function summaryStatus(id: string): Promise<string | null | undefined> {
  const rows = await rest("GET", `meetings?id=eq.${id}&select=summary_status`);
  return (rows as Array<{ summary_status: string | null }>)[0]?.summary_status;
}

async function cron(): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${PORT_BOT}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cron-Secret": CRON_SECRET,
    },
    body: JSON.stringify({ meetings_watchdog: true }),
  });
  await res.body?.cancel();
  return res.status;
}

const mine = () => inbox.filter((m) => PEOPLE.includes(m.chat_id));

async function scenario(): Promise<void> {
  // 1. Настоящий heartbeat ОДНОГО агента по четырём встречам через meeting-heartbeat. Живая
  //    встреча бьёт последней: до D018 её удар затирал в общей строке агента удары остальных.
  for (const k of ["dead", "notified", "alive2", "alive"] as const) {
    const status = await beat(MEETING[k], MEETING[k].owner);
    expect(`heartbeat ${k} принят`, status === 200, `HTTP ${status}`);
  }
  const deadBeat = await meetingBeat(MEETING.dead.id);
  expect(
    "heartbeat бота лёг в строку своей встречи: recording=true и время удара",
    deadBeat?.agent_last_recording === true && !!deadBeat?.agent_last_seen_at,
    JSON.stringify(deadBeat),
  );
  const agent = await agentRow();
  expect(
    "строка агента отмечает «жив, сборка 1»",
    !!agent?.last_seen_at && agent?.last_version === 1,
    JSON.stringify(agent),
  );
  expect(
    "heartbeat бота НЕ тронул строку человека",
    (await humanRecording(OWNER)) === null,
  );

  // Владение: агент не освежает встречу, заявленную за другого человека, и встречу чужого
  // воркспейса — иначе мог бы погасить её сторожа.
  const foreignOwner = await beat(MEETING.dead, OWNER_ALIVE);
  expect(
    "удар во встречу другого человека (claim_owner не тот) → 403",
    foreignOwner === 403,
    `HTTP ${foreignOwner}`,
  );
  const foreignWs = await beat(FOREIGN, FOREIGN.owner);
  expect(
    "удар во встречу чужого воркспейса → 403",
    foreignWs === 403,
    `HTTP ${foreignWs}`,
  );
  expect(
    "встреча чужого воркспейса осталась нетронутой",
    (await meetingBeat(FOREIGN.id))?.agent_last_seen_at === null,
    JSON.stringify(await meetingBeat(FOREIGN.id)),
  );

  // 1б. Перехват (D019, D020). Бот пишет календарную встречу за OWNER. Пока он пишет, рекордер
  //     TAKER с часом записи встречу НЕ перехватывает (D020: запись другого человека откладывается).
  //     Бот перестал писать (удар recording:false, контейнер ещё жив) — перехват настоящим
  //     meeting-claim по прежнему правилу полноты (час записи против нуля у бота).
  const takenBeat = await beat(TAKEN, TAKEN.owner);
  expect(
    "heartbeat бота по будущей перехваченной встрече принят",
    takenBeat === 200,
    `HTTP ${takenBeat}`,
  );
  const whileWriting = await takeOver();
  const afterDefer = await meetingBeat(TAKEN.id);
  expect(
    "D020: пока бот пишет, запись другого человека встречу не перехватывает (defer, пульс бота цел)",
    whileWriting.status === 200 && whileWriting.body.decision === "defer" &&
      (await claimOwner(TAKEN.id)) === TAKEN.owner &&
      afterDefer?.agent_last_recording === true,
    JSON.stringify({ whileWriting, afterDefer }),
  );
  const leaseBefore = (await arbRow(TAKEN.id))?.lease_expires_at;
  const stopped = await beatRaw(TAKEN, TAKEN.owner, { recording: false });
  expect(
    "удар бота recording:false принят и лиз НЕ продлил — непишущий контейнер встречу не держит",
    stopped.status === 200 &&
      (await arbRow(TAKEN.id))?.lease_expires_at === leaseBefore,
    JSON.stringify({ stopped, leaseBefore, after: await arbRow(TAKEN.id) }),
  );
  const claim = await takeOver();
  expect(
    "meeting-claim: у непишущего бота рекордер TAKER — претендент (transcribe, та же встреча)",
    claim.status === 200 && claim.body.decision === "transcribe" &&
      claim.body.meeting_id === TAKEN.id && (await claimOwner(TAKEN.id)) === TAKEN.owner,
    JSON.stringify(claim),
  );
  const upload = await uploadAs(TAKEN.id, 3600);
  expect(
    "meeting-ingest: выгрузка часа записи принята и измерена — право перешло к TAKER",
    upload.status === 202 && upload.body.ok === true,
    JSON.stringify(upload),
  );
  const afterTake = await meetingBeat(TAKEN.id);
  expect(
    "перехват по выгрузке тем же UPDATE погасил пульс бота: claim_owner = TAKER, agent_last_recording = false",
    (await claimOwner(TAKEN.id)) === TAKER &&
      afterTake?.agent_last_recording === false,
    JSON.stringify(afterTake),
  );
  const refused = await beatRaw(TAKEN, TAKEN.owner);
  expect(
    "удар бота после перехвата → 403 с причиной not_claim_owner, флаг не вернулся",
    refused.status === 403 && refused.body.code === "not_claim_owner" &&
      (await meetingBeat(TAKEN.id))?.agent_last_recording === false,
    JSON.stringify(refused),
  );

  // 1в. Монотонность: в строке уже более свежий удар (recording:false), опоздавший recording:true
  //     не должен его перетереть — иначе сторож взвёлся бы на закончившейся встрече.
  const fresher = new Date(Date.now() + 2 * 60_000).toISOString();
  await rest("PATCH", `meetings?id=eq.${LATE.id}`, {
    agent_last_seen_at: fresher,
    agent_last_recording: false,
  });
  const late = await beatRaw(LATE, LATE.owner);
  const lateRow = await meetingBeat(LATE.id);
  expect(
    "опоздавший удар принят без записи (200, stale) и не перетёр более свежий",
    late.status === 200 && late.body.stale === true &&
      lateRow?.agent_last_recording === false &&
      Date.parse(lateRow?.agent_last_seen_at ?? "") === Date.parse(fresher),
    JSON.stringify({ late, lateRow }),
  );

  // 2. Состарить: dead и notified замолчали 15 мин назад, обе встречи alive свежие; люди — как
  //    в жизни. Строка агента при этом свежая (alive бил последним) — сторож обязан её не слушать.
  await rest(
    "PATCH",
    `meetings?id=in.(${MEETING.dead.id},${MEETING.notified.id},${TAKEN.id})`,
    { agent_last_seen_at: minutesAgo(15) },
  );
  await rest("PATCH", `allowed_users?telegram_id=eq.${HUMAN_CRASH}`, {
    recorder_last_recording: true,
    recorder_last_seen: minutesAgo(25),
  });
  await rest("PATCH", `allowed_users?telegram_id=eq.${HUMAN_ALIVE}`, {
    recorder_last_recording: true,
    recorder_last_seen: minutesAgo(5),
  });
  await rest("POST", "meeting_notices", [{
    meeting_id: MEETING.notified.id,
    recipient_id: OWNER_NOTIFIED,
    kind: "container_died",
    attempt: 1,
    status: "sent",
  }]);

  // 3. Настоящий cron сторожа.
  expect("cron meetings_watchdog ответил 200", (await cron()) === 200);
  const got = mine();
  const to = (id: number) => got.filter((m) => m.chat_id === id);
  expect(
    "бот замолчал → человеку, за которого он писал, алерт EN+RU с названием встречи",
    to(OWNER).length === 1 &&
      to(OWNER)[0].text.includes("scriba stopped responding") &&
      to(OWNER)[0].text.includes("scriba перестал отвечать") &&
      to(OWNER)[0].text.includes("Weekly &lt;sync&gt;"),
    JSON.stringify(to(OWNER)),
  );
  expect(
    "container_died уже был → второго алерта нет",
    to(OWNER_NOTIFIED).length === 0,
  );
  expect(
    "две живые встречи того же агента → тишина по обеим",
    to(OWNER_ALIVE).length === 0,
    JSON.stringify(to(OWNER_ALIVE)),
  );
  expect(
    "bumblebee замолчал → алерт ему самому, текст про bumblebee (как раньше)",
    to(HUMAN_CRASH).length === 1 &&
      to(HUMAN_CRASH)[0].text.includes("bumblebee"),
    JSON.stringify(to(HUMAN_CRASH)),
  );
  expect("живой bumblebee → тишина", to(HUMAN_ALIVE).length === 0);
  expect(
    "перехваченная встреча: новому claim_owner нет ложного алерта «scriba перестал отвечать»",
    !to(TAKER).some((m) => m.text.includes("scriba stopped responding") || m.text.includes("scriba перестал отвечать")),
    JSON.stringify(to(TAKER)),
  );
  expect(
    "флаг замолчавшей встречи сброшен",
    (await meetingBeat(MEETING.dead.id))?.agent_last_recording === false,
  );
  expect(
    "флаг встречи с container_died сброшен",
    (await meetingBeat(MEETING.notified.id))?.agent_last_recording === false,
  );
  expect(
    "флаги живых встреч не тронуты",
    (await meetingBeat(MEETING.alive.id))?.agent_last_recording === true &&
      (await meetingBeat(MEETING.alive2.id))?.agent_last_recording === true,
  );
  expect(
    "флаг замолчавшего bumblebee сброшен",
    (await humanRecording(HUMAN_CRASH)) === false,
  );
  expect(
    "флаг живого bumblebee не тронут",
    (await humanRecording(HUMAN_ALIVE)) === true,
  );

  // Сторож встреч-призраков (#549): все встречи пустые и старше 15 минут.
  expect(
    "встреча, которую ещё пишет бот (свежий heartbeat по ней), не помечена failed",
    (await summaryStatus(MEETING.alive.id)) === null,
    String(await summaryStatus(MEETING.alive.id)),
  );
  expect(
    "вторая одновременная встреча того же агента тоже не помечена failed",
    (await summaryStatus(MEETING.alive2.id)) === null,
    String(await summaryStatus(MEETING.alive2.id)),
  );
  expect(
    "встреча замолчавшего бота помечена failed, как раньше",
    (await summaryStatus(MEETING.dead.id)) === "failed",
    String(await summaryStatus(MEETING.dead.id)),
  );
  expect(
    "призрак рекордера человека (бота нет) помечен failed, как раньше",
    (await summaryStatus(GHOST.human.id)) === "failed",
    String(await summaryStatus(GHOST.human.id)),
  );
  expect(
    "пустая встреча моложе 15 минут не тронута",
    (await summaryStatus(GHOST.fresh.id)) === null,
    String(await summaryStatus(GHOST.fresh.id)),
  );
  expect(
    "старая встреча с транскриптом не тронута",
    (await summaryStatus(GHOST.filled.id)) === null,
    String(await summaryStatus(GHOST.filled.id)),
  );

  // 4. Повторный прогон: дедуп, ни одного нового сообщения.
  const before = mine().length;
  await cron();
  expect(
    "повторный cron никому не пишет второй раз",
    mine().length === before,
    `${before} → ${mine().length}`,
  );

  // 5. Арбитраж (T155) — после сторожа: его ожидания считают сообщения людям.
  await arbitration();
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "КРАСНЫЙ: нет SMOKE_SUPABASE_URL / SMOKE_SERVICE_KEY — смоук не выполнялся (см. шапку).",
    );
    Deno.exit(1);
  }
  const tg = startTelegram();
  const hb = spawnFunction(
    "../supabase/functions/meeting-heartbeat/index.ts",
    PORT_HB,
  );
  const claimFn = spawnFunction(
    "../supabase/functions/meeting-claim/index.ts",
    PORT_CLAIM,
  );
  const bot = spawnFunction(
    "../supabase/functions/swarm-bot/index.ts",
    PORT_BOT,
    [`--preload=${PRELOAD}`],
  );
  const ingest = spawnFunction(
    "../supabase/functions/meeting-ingest/index.ts",
    PORT_INGEST,
    [`--preload=${PRELOAD}`],
  );
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_HB, 30_000)) &&
      (await waitPort(PORT_CLAIM, 30_000)) &&
      (await waitPort(PORT_BOT, 30_000)) &&
      (await waitPort(PORT_INGEST, 30_000));
    if (ready) await scenario();
  } finally {
    hb.kill("SIGTERM");
    claimFn.kill("SIGTERM");
    bot.kill("SIGTERM");
    ingest.kill("SIGTERM");
    await ingest.status;
    await hb.status;
    await claimFn.status;
    await bot.status;
    await tg.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_HB}/${PORT_CLAIM}/${PORT_BOT}/${PORT_INGEST} за 30 с — проверять нечего.`,
    );
    Deno.exit(1);
  }
  for (const c of checks) {
    console.log(
      `${c.ok ? "✔" : "✘"} ${c.name}${
        c.ok || !c.detail ? "" : ` — ${c.detail}`
      }`,
    );
  }
  for (const p of cleanupProblems) console.log(`✘ уборка: ${p}`);
  const failed = checks.filter((c) => !c.ok).length + cleanupProblems.length;
  console.log(
    failed === 0
      ? `ЗЕЛЁНЫЙ: ${checks.length} ожиданий`
      : `КРАСНЫЙ: не сошлось ${failed}`,
  );
  Deno.exit(failed === 0 ? 0 : 1);
}

await main();
