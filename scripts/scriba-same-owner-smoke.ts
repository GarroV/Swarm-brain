#!/usr/bin/env -S deno run --allow-all
// Смоук «две записи одной встречи одного владельца» (T156): бот scriba пишет встречу за человека,
// а его же рекордер bumblebee пишет ту же встречу параллельно. Настоящий meeting-claim склеивает
// их в одну строку (склейка по составу, #168) и может «перехватить» право у бота, не меняя
// claim_owner — это тот же человек. Оба клиента льют аудио в настоящий meeting-ingest.
//
// Проверяется то, что обязано держаться при любом порядке выгрузок:
//   • стенограмма не задваивается и не смешивает две записи — в ней сегменты ровно одной;
//   • остаётся более полная запись (объём распознанного, `_shared/meeting-fullness.ts`) — а не
//     та, что пришла первой или последней;
//   • повтор той же выгрузки (потерянный ответ → ретрай клиента) не запускает вторую обработку.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять:
// смоук заводит и удаляет строки и файлы в бакете meeting-audio.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Порты — от SMOKE_PORT_BASE (по умолчанию 4490; base..base+3 — сам контур): base+4 — функция
// meeting-claim, base+5 — функция meeting-ingest, base+6 — поддельные OpenAI и Telegram, base+7 —
// функция meeting-process (её дёргает смоук вместо pg_cron), base+8 — функция meeting-heartbeat
// (удары пишущего бота, D020). Функции ходят в api.openai.com и
// api.telegram.org напрямую, поэтому fetch подменяется предзагрузкой (--preload) только для этих
// хостов: ни OpenAI, ни людям ничего не уходит.
//
// Поддельный Whisper отвечает по содержимому файла части: `<метка>:<сегментов>[:<задержка мс>]`
// — так смоук знает, чья запись оказалась в стенограмме и насколько она полная.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-same-owner-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

import { seedInviteGrant } from "./scriba-smoke-grants.ts";

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4490");
const PORT_CLAIM = PORT_BASE + 4;
const PORT_INGEST = PORT_BASE + 5;
const PORT_FAKE = PORT_BASE + 6;
const PORT_PROCESS = PORT_BASE + 7;
const PORT_HB = PORT_BASE + 8;
const CRON_SECRET = "smoke-cron-secret";
const BUCKET = "meeting-audio";

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-so-${RUN}`;
const OWNER = 930_000_000_000 + RUN * 10;
const OWNER_EMAIL = `owner-${RUN}@smoke.test`;
const RECORDER_TOKEN = `so-rec-${RUN}`;
const AGENT = { id: `scriba-so-${RUN}`, token: `so-bot-${RUN}` };
const createdMeetings = new Set<string>();

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

async function storage(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ── Поддельные OpenAI и Telegram ────────────────────────────────────────────────

const inbox: Array<{ chat_id: number; text: string }> = [];
let whisperCalls = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function startFake(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT_FAKE,
    onListen: () => {},
  }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/sendMessage")) {
      const body = await req.json().catch(() => ({}));
      inbox.push({
        chat_id: Number(body.chat_id),
        text: String(body.text ?? ""),
      });
      return Response.json({ ok: true, result: { message_id: inbox.length } });
    }
    if (path === "/v1/audio/transcriptions") {
      whisperCalls++;
      const form = await req.formData();
      const file = form.get("file");
      const spec = file instanceof File ? (await file.text()).trim() : "";
      const [label = "?", countRaw = "0", delayRaw = "0"] = spec.split(":");
      await sleep(Number(delayRaw) || 0);
      const n = Number(countRaw) || 0;
      const segments = Array.from({ length: n }, (_, i) => ({
        start: i * 10,
        end: i * 10 + 9,
        text: `${label} реплика номер ${i} про план работ на квартал`,
        no_speech_prob: 0.01,
        avg_logprob: -0.2,
      }));
      return Response.json({
        text: segments.map((s) => s.text).join(" "),
        language: "russian",
        segments,
      });
    }
    if (path === "/v1/chat/completions") {
      return Response.json({
        choices: [{
          message: { content: "- Обсудили план работ на квартал" },
          finish_reason: "stop",
        }],
      });
    }
    return new Response("not found", { status: 404 });
  });
}

const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const host of ["https://api.telegram.org", "https://api.openai.com"]) {
    if (url.startsWith(host + "/")) return real(url.replace(host, "http://127.0.0.1:${PORT_FAKE}"), init);
  }
  return real(input, init);
};`)
}`;

function spawnFunction(path: string, port: number): Deno.ChildProcess {
  return new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      `--preload=${PRELOAD}`,
      decodeURIComponent(new URL(path, import.meta.url).pathname),
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
      await sleep(300);
    }
  }
  return false;
}

// ── Засев и уборка ──────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke same owner" }]);
  await rest("POST", "allowed_users", [{
    telegram_id: OWNER,
    group_id: WS,
    added_by: OWNER,
    email: OWNER_EMAIL,
    recorder_token_hash: await sha256Hex(RECORDER_TOKEN),
  }]);
  await rest("POST", "service_agents", [{
    id: AGENT.id,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(AGENT.token),
  }]);
  const bucket = await storage("POST", "bucket", {
    id: BUCKET,
    name: BUCKET,
    public: false,
  });
  await bucket.body?.cancel(); // уже есть — 409, это нормально
}

async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const ids = [...createdMeetings];
  if (ids.length > 0) {
    const listed = await Promise.all(ids.map(async (id) => {
      const res = await storage("POST", `object/list/${BUCKET}`, {
        prefix: id,
        limit: 1000,
      });
      const rows = res.ok
        ? await res.json() as Array<{ name: string; id: string | null }>
        : [];
      // Вложенные «папки» (id=null) раскрываем на один уровень — части лежат не глубже.
      const nested = await Promise.all(
        rows.filter((r) => r.id === null).map(async (dir) => {
          const r2 = await storage("POST", `object/list/${BUCKET}`, {
            prefix: `${id}/${dir.name}`,
            limit: 1000,
          });
          const inner = r2.ok ? await r2.json() as Array<{ name: string }> : [];
          return inner.map((f) => `${id}/${dir.name}/${f.name}`);
        }),
      );
      return [
        ...rows.filter((r) => r.id !== null).map((r) => `${id}/${r.name}`),
        ...nested.flat(),
      ];
    }));
    const paths = listed.flat();
    if (paths.length > 0) {
      const res = await storage("DELETE", `object/${BUCKET}`, {
        prefixes: paths,
      });
      if (!res.ok) problems.push(`storage: ${res.status} ${await res.text()}`);
      else await res.body?.cancel();
    }
  }
  const steps: Array<[string, string]> = [
    ["DELETE", `meeting_agent_grants?group_id=eq.${WS}`],
    ["DELETE", `meeting_invites?group_id=eq.${WS}`],
    ...(ids.length > 0
      ? [["DELETE", `meetings?id=in.(${ids.join(",")})`] as [string, string]]
      : []),
    ["DELETE", `service_agents?id=eq.${AGENT.id}`],
    ["DELETE", `allowed_users?telegram_id=eq.${OWNER}`],
    ["DELETE", `workspaces?id=eq.${WS}`],
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

// ── Клиенты: бот и рекордер одного человека ─────────────────────────────────────

type Json = Record<string, unknown>;

async function post(
  port: number,
  headers: Record<string, string>,
  body: BodyInit,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers,
    body,
  });
  const parsed = await res.json().catch(() => ({})) as Json;
  return { status: res.status, body: parsed };
}

// Бот за человека ходит пропуском своей встречи (T165): пропуск выдаётся к приглашению, первая
// заявка привязывает его к встрече. Здесь — пропуск каждой встречи бота по её id.
const grants = new Map<string, string>();
function botHeaders(meetingId: string): Record<string, string> {
  const grant = grants.get(meetingId);
  if (!grant) throw new Error(`нет пропуска бота на встречу ${meetingId}`);
  return { Authorization: `Bearer ${grant}`, "X-On-Behalf-Of": String(OWNER) };
}
const recHeaders = { Authorization: `Bearer ${RECORDER_TOKEN}` };

/** Бот заявляется до захода: ручная встреча по приглашению, запись 0 с (как `manualClaim`). */
async function botClaim(startedAt: string): Promise<string> {
  const { token, inviteId, joinUrl } = await seedInviteGrant(rest, {
    agentId: AGENT.id,
    groupId: WS,
    telegramId: OWNER,
    meetingId: null,
  });
  const res = await post(
    PORT_CLAIM,
    {
      Authorization: `Bearer ${token}`,
      "X-On-Behalf-Of": String(OWNER),
      "Content-Type": "application/json",
    },
    JSON.stringify({
      identity_kind: "manual",
      identity_key: `scriba:${crypto.randomUUID()}`,
      started_at: startedAt,
      agent_version: "scriba-1",
      recorded_seconds: 0,
      invite_id: inviteId,
      join_url: joinUrl,
    }),
  );
  const id = String(res.body.meeting_id ?? "");
  if (res.status !== 200 || !id) {
    throw new Error(`claim бота: ${res.status} ${JSON.stringify(res.body)}`);
  }
  createdMeetings.add(id);
  grants.set(id, token);
  return id;
}

/** Рекордер заявляется на стопе: календарная встреча с человеком в составе и длительностью. */
async function recorderClaim(
  startedAt: string,
  seconds: number,
): Promise<Json> {
  const res = await post(
    PORT_CLAIM,
    { ...recHeaders, "Content-Type": "application/json" },
    JSON.stringify({
      identity_kind: "calendar",
      identity_key: `cal:smoke-so-${RUN}-${crypto.randomUUID()}`,
      title: "Quarter planning",
      started_at: startedAt,
      attendees: [{ name: "Owner", email: OWNER_EMAIL }, {
        name: "Guest",
        email: `guest-${RUN}@smoke.test`,
      }],
      agent_version: "0.1.0",
      recorded_seconds: seconds,
    }),
  );
  if (typeof res.body.meeting_id === "string") {
    createdMeetings.add(res.body.meeting_id);
  }
  return { status: res.status, ...res.body };
}

/** Выгрузка: каждая часть — файл с заданием поддельному Whisper (`метка:сегментов:задержка`). */
function ingestForm(
  meetingId: string,
  label: string,
  parts: Array<{ segments: number; delayMs?: number }>,
): FormData {
  const form = new FormData();
  form.append("meeting_id", meetingId);
  form.append(
    "sys_parts",
    JSON.stringify(
      parts.map((_, i) => ({
        name: `part-${String(i).padStart(3, "0")}`,
        offset: i * 600,
      })),
    ),
  );
  parts.forEach((p, i) => {
    const spec = `${label}:${String(p.segments)}:${String(p.delayMs ?? 0)}`;
    form.append(
      `part-${String(i).padStart(3, "0")}`,
      new File([spec], `part-${String(i).padStart(3, "0")}.m4a`, {
        type: "audio/m4a",
      }),
    );
  });
  return form;
}

/** Удар бота по встрече — как шлёт его контейнер (session.heartbeat). */
async function botBeat(
  meetingId: string,
  recording: boolean,
  seconds?: number,
): Promise<{ status: number; body: Json }> {
  return await post(
    PORT_HB,
    { ...botHeaders(meetingId), "Content-Type": "application/json" },
    JSON.stringify({
      recording,
      version: 1,
      meeting_id: meetingId,
      ...(seconds !== undefined && { recorded_seconds: seconds }),
    }),
  );
}

interface Held {
  claim_owner: number | null;
  lease_expires_at: string | null;
  agent_last_recording: boolean | null;
  recorded_seconds: number | null;
}

async function held(id: string): Promise<Held> {
  const [r] = await rest(
    "GET",
    `meetings?id=eq.${id}&select=claim_owner,lease_expires_at,agent_last_recording,recorded_seconds`,
  ) as Held[];
  return r;
}

/**
 * Бот пишет встречу 25 минут: заявился до захода (лиз от claim сдвинут назад, будто claim был
 * 25 минут назад — иначе потолок роста секунд в heartbeat честно не дал бы записать 1200 с), бьёт
 * recording:true с 1200 с. Затем рекордер того же человека заканчивает запись на 600 с — встреча у
 * пишущего бота: запасная (D020), а не перехват.
 */
async function recorderWhileBotWrites(
  tag: string,
  started: string,
): Promise<{ id: string; ok: boolean }> {
  const id = await botClaim(started);
  await rest("PATCH", `meetings?id=eq.${id}`, {
    lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  const beat = await botBeat(id, true, 1200);
  const before = await held(id);
  const claim = await recorderClaim(started, 600);
  const after = await held(id);
  const next = await botBeat(id, true, 1210);
  const ok = beat.status === 200 && before.agent_last_recording === true &&
    before.recorded_seconds === 1200 &&
    claim.meeting_id === id && claim.decision === "transcribe" &&
    after.claim_owner === OWNER && after.agent_last_recording === true &&
    after.lease_expires_at === before.lease_expires_at &&
    after.recorded_seconds === 1200 &&
    next.status === 200;
  expect(
    `${tag}: рекордер закончил, пока бот пишет, — запасная: выгружай, встреча не перехвачена (лиз и пульс бота целы, удары бота 200)`,
    ok,
    JSON.stringify({ beat, before, claim, after, next }),
  );
  return { id, ok };
}

async function ingest(
  who: "bot" | "rec",
  form: FormData,
): Promise<{ status: number; body: Json }> {
  const headers = who === "bot"
    ? botHeaders(String(form.get("meeting_id")))
    : recHeaders;
  return await post(PORT_INGEST, headers, form);
}

// ── Наблюдение ──────────────────────────────────────────────────────────────────

interface Row {
  claim_owner: number | null;
  summary_status: string | null;
  processing_lease: string | null;
  transcript: { segments?: Array<{ text: string }> } | null;
}

async function row(id: string): Promise<Row> {
  const [r] = await rest(
    "GET",
    `meetings?id=eq.${id}&select=claim_owner,summary_status,processing_lease,transcript`,
  ) as Row[];
  if (!r) throw new Error(`встреча ${id} пропала`);
  return r;
}

async function queuedExists(id: string): Promise<boolean> {
  const res = await storage("POST", `object/list/${BUCKET}`, {
    prefix: id,
    search: "queued",
    limit: 10,
  });
  const rows = res.ok ? await res.json() as Array<{ name: string }> : [];
  return rows.some((r) => r.name.startsWith("queued"));
}

/** Состав стенограммы: сколько сегментов чьей записи. */
function composition(r: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of r.transcript?.segments ?? []) {
    const label = s.text.split(" ")[0] ?? "?";
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

async function cronTick(): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${PORT_PROCESS}/`, {
    method: "POST",
    headers: {
      "X-Cron-Secret": CRON_SECRET,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
  await res?.body?.cancel();
}

/** Ждём, пока встреча успокоится: не в обработке, без лиза и без записи в очереди. */
async function settle(id: string, ms = 60_000): Promise<Row> {
  const until = Date.now() + ms;
  let last = await row(id);
  while (Date.now() < until) {
    last = await row(id);
    if (
      last.summary_status !== "processing" && last.processing_lease === null &&
      !(await queuedExists(id))
    ) {
      return last;
    }
    await cronTick();
    await sleep(1000);
  }
  return last;
}

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

/** Итог сценария: в стенограмме ровно одна запись, та, что ожидалась, и целиком. */
function expectOnly(
  scenario: string,
  r: Row,
  label: string,
  segments: number,
): void {
  const comp = composition(r);
  expect(
    `${scenario}: стенограмма — только запись «${label}», ${
      String(segments)
    } сегментов, без примеси второй`,
    r.summary_status === "done" && Object.keys(comp).length === 1 &&
      comp[label] === segments,
    `status=${String(r.summary_status)} состав=${JSON.stringify(comp)}`,
  );
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

// Сценарии разнесены по времени на 30 мин: склейка по составу ищет встречу ±10 мин от начала, и
// рекордер одного сценария иначе присоединился бы к встрече бота из соседнего.

// ── Сценарии ────────────────────────────────────────────────────────────────────

async function scenario(): Promise<void> {
  // A. Рекордер выгрузил первым и короче; бот выгрузил позже, и его запись полнее.
  {
    const started = ago(20);
    const id = await botClaim(started);
    const claim = await recorderClaim(started, 400);
    expect(
      "A: meeting-claim склеил запись рекордера со встречей бота, владелец тот же",
      claim.meeting_id === id && claim.decision === "transcribe" &&
        (await row(id)).claim_owner === OWNER,
      JSON.stringify(claim),
    );
    const rec = await ingest("rec", ingestForm(id, "rec", [{ segments: 3 }]));
    expect(
      "A: выгрузка рекордера принята",
      rec.status === 202 || rec.status === 200,
      JSON.stringify(rec),
    );
    await settle(id);
    const bot = await ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 20 }, { segments: 20 }]),
    );
    expect(
      "A: выгрузка бота принята",
      bot.status === 202 || bot.status === 200,
      JSON.stringify(bot),
    );
    expectOnly("A (рекордер первым, бот полнее)", await settle(id), "bot", 40);
  }

  // B. Бот выгрузил первым, обработка готова; рекордер короче (≥5 мин — claim отдаёт ему право).
  {
    const started = ago(50);
    const id = await botClaim(started);
    await ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 20 }, { segments: 20 }]),
    );
    await settle(id);
    const claim = await recorderClaim(started, 400);
    expect(
      "B: claim рекордера — та же встреча",
      claim.meeting_id === id,
      JSON.stringify(claim),
    );
    if (claim.decision === "transcribe") {
      await ingest("rec", ingestForm(id, "rec", [{ segments: 3 }]));
    }
    expectOnly(
      "B (бот первым и готов, рекордер короче)",
      await settle(id),
      "bot",
      40,
    );
  }

  // C. Бот выгрузил первым, обработка готова; рекордер заметно полнее — он и остаётся.
  {
    const started = ago(80);
    const id = await botClaim(started);
    await ingest("bot", ingestForm(id, "bot", [{ segments: 3 }]));
    await settle(id);
    const claim = await recorderClaim(started, 1800);
    expect(
      "C: claim рекордера — та же встреча, право у него",
      claim.meeting_id === id && claim.decision === "transcribe",
      JSON.stringify(claim),
    );
    if (claim.decision === "transcribe") {
      await ingest(
        "rec",
        ingestForm(id, "rec", [{ segments: 20 }, { segments: 20 }]),
      );
    }
    expectOnly(
      "C (бот первым и готов, рекордер полнее)",
      await settle(id),
      "rec",
      40,
    );
  }

  // D. Бот выгрузил первым и ещё транскрибируется; рекордер полнее и приходит посреди обработки.
  {
    const started = ago(110);
    const id = await botClaim(started);
    const botUpload = ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 3, delayMs: 2500 }, {
        segments: 3,
        delayMs: 2500,
      }]),
    );
    await sleep(1200);
    const claim = await recorderClaim(started, 1800);
    expect(
      "D: claim рекордера — та же встреча",
      claim.meeting_id === id,
      JSON.stringify(claim),
    );
    const recUpload = claim.decision === "transcribe"
      ? ingest(
        "rec",
        ingestForm(id, "rec", [{ segments: 20 }, { segments: 20 }]),
      )
      : Promise.resolve(null);
    await Promise.all([botUpload, recUpload]);
    expectOnly(
      "D (бот в обработке, рекордер полнее)",
      await settle(id),
      "rec",
      40,
    );
  }

  // E. Бот выгрузил первым и ещё транскрибируется; рекордер короче и приходит посреди обработки.
  {
    const started = ago(140);
    const id = await botClaim(started);
    const botUpload = ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 20, delayMs: 2500 }, {
        segments: 20,
        delayMs: 2500,
      }]),
    );
    await sleep(1200);
    const claim = await recorderClaim(started, 400);
    expect(
      "E: claim рекордера — та же встреча",
      claim.meeting_id === id,
      JSON.stringify(claim),
    );
    const recUpload = claim.decision === "transcribe"
      ? ingest("rec", ingestForm(id, "rec", [{ segments: 3 }]))
      : Promise.resolve(null);
    await Promise.all([botUpload, recUpload]);
    expectOnly(
      "E (бот в обработке, рекордер короче)",
      await settle(id),
      "bot",
      40,
    );
  }

  // G. Встреча длиннее лиза бота (30 мин): claim рекордера занимает её без сброса маркеров, пока бот
  //    ещё транскрибируется, — выгрузка рекордера встаёт в очередь и сравнивается после бота.
  {
    const started = ago(200);
    const id = await botClaim(started);
    await rest("PATCH", `meetings?id=eq.${id}`, { lease_expires_at: ago(1) });
    const botUpload = ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 3, delayMs: 2500 }, {
        segments: 3,
        delayMs: 2500,
      }]),
    );
    await sleep(1200);
    const claim = await recorderClaim(started, 1800);
    expect(
      "G: claim рекордера — та же встреча, право у него",
      claim.meeting_id === id && claim.decision === "transcribe",
      JSON.stringify(claim),
    );
    const rec = await ingest(
      "rec",
      ingestForm(id, "rec", [{ segments: 20 }, { segments: 20 }]),
    );
    expect(
      "G: выгрузка рекордера посреди обработки бота принята в очередь (202 processing), не отброшена",
      rec.status === 202 && rec.body.summary_status === "processing",
      JSON.stringify(rec),
    );
    await botUpload;
    expectOnly(
      "G (лиз бота истёк, рекордер полнее, в очереди)",
      await settle(id),
      "rec",
      40,
    );
  }

  // D020 — рекордер того же человека закончил запись, пока бот ещё пишет. Три исхода.
  // H. Бот дописал дольше: запасная запись рекордера обработана сразу и не потеряна, итоговая
  //    запись бота полнее — она и остаётся.
  {
    const started = ago(260);
    const { id } = await recorderWhileBotWrites("H", started);
    await ingest("rec", ingestForm(id, "rec", [{ segments: 3 }]));
    expectOnly(
      "H: запасная запись рекордера не потеряна, пока бот пишет",
      await settle(id),
      "rec",
      3,
    );
    await botBeat(id, false);
    await ingest(
      "bot",
      ingestForm(id, "bot", [{ segments: 20 }, { segments: 20 }]),
    );
    expectOnly("H (бот дописал дольше рекордера)", await settle(id), "bot", 40);
  }

  // I. Бот умер раньше: удары прекратились, выгрузки бота нет — остаётся запись рекордера.
  {
    const started = ago(290);
    const { id } = await recorderWhileBotWrites("I", started);
    await ingest(
      "rec",
      ingestForm(id, "rec", [{ segments: 20 }, { segments: 20 }]),
    );
    const r = await settle(id);
    expectOnly("I (бот умер, не выгрузив)", r, "rec", 40);
    expect(
      "I: встреча осталась за тем же человеком",
      r.claim_owner === OWNER,
      String(r.claim_owner),
    );
  }

  // J. Рекордер длиннее итоговой записи бота: бот выгрузил короче — запись рекордера остаётся.
  {
    const started = ago(320);
    const { id } = await recorderWhileBotWrites("J", started);
    await ingest(
      "rec",
      ingestForm(id, "rec", [{ segments: 20 }, { segments: 20 }]),
    );
    await settle(id);
    await botBeat(id, false);
    await ingest("bot", ingestForm(id, "bot", [{ segments: 3 }]));
    expectOnly(
      "J (рекордер длиннее итоговой записи бота)",
      await settle(id),
      "rec",
      40,
    );
  }

  // F. Повтор той же выгрузки (ответ потерялся, клиент ретраит) — вторая обработка не запускается.
  {
    const started = ago(230);
    const id = await botClaim(started);
    await ingest("bot", ingestForm(id, "bot", [{ segments: 5 }]));
    await settle(id);
    const before = whisperCalls;
    const notesBefore = inbox.length;
    const again = await ingest("bot", ingestForm(id, "bot", [{ segments: 5 }]));
    const r = await settle(id);
    expect(
      "F: повтор выгрузки бота — already_processed, Whisper не звался, второго уведомления нет",
      again.body.summary_status === "already_processed" &&
        whisperCalls === before && inbox.length === notesBefore,
      `${JSON.stringify(again.body)} whisper ${String(before)}→${
        String(whisperCalls)
      } tg ${String(notesBefore)}→${String(inbox.length)}`,
    );
    expectOnly("F (повтор)", r, "bot", 5);
  }
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "КРАСНЫЙ: нет SMOKE_SUPABASE_URL / SMOKE_SERVICE_KEY — смоук не выполнялся (см. шапку).",
    );
    Deno.exit(1);
  }
  const fake = startFake();
  const fns = [
    spawnFunction("../supabase/functions/meeting-claim/index.ts", PORT_CLAIM),
    spawnFunction("../supabase/functions/meeting-ingest/index.ts", PORT_INGEST),
    spawnFunction(
      "../supabase/functions/meeting-process/index.ts",
      PORT_PROCESS,
    ),
    spawnFunction("../supabase/functions/meeting-heartbeat/index.ts", PORT_HB),
  ];
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_CLAIM, 30_000)) &&
      (await waitPort(PORT_INGEST, 30_000)) &&
      (await waitPort(PORT_PROCESS, 30_000)) &&
      (await waitPort(PORT_HB, 30_000));
    if (ready) await scenario();
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_CLAIM}/${PORT_INGEST}/${PORT_PROCESS}/${PORT_HB} за 30 с.`,
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
      ? `ЗЕЛЁНЫЙ: ${String(checks.length)} ожиданий`
      : `КРАСНЫЙ: не сошлось ${String(failed)}`,
  );
  Deno.exit(failed === 0 ? 0 : 1);
}

await main();
