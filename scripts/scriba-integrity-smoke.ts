#!/usr/bin/env -S deno run --allow-all
// Смоук «целостность записи встречи»: две записи одной встречи от РАЗНЫХ людей (и запись после
// публикации) через настоящие meeting-claim / meeting-ingest / meeting-process поверх базы и
// Storage. Проверяется то, что обязано держаться при любом порядке и времени выгрузок:
//
//   • опубликованная команде встреча (status=in_base) второй записью не переписывается, и
//     «тезисы готовы» по ней повторно не рассылаются;
//   • владелец встречи — тот, чья запись осталась стенограммой: более длинная, но беднее
//     распознанным запись другого человека не забирает встречу себе;
//   • запись держателя, которая ещё обрабатывается, не выбрасывается приходом более длинной:
//     обе сравниваются по объёму распознанного, как если бы первая успела закончиться;
//   • запись другого человека не принимается за повтор чужой выгрузки.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять:
// смоук заводит и удаляет строки и файлы в бакете meeting-audio.
//
//   SMOKE_SUPABASE_URL   — http://<адрес API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Функции смоук поднимает сам процессами Deno на 127.0.0.1 от SMOKE_PORT_BASE (по умолчанию 4490):
// base+4 — meeting-claim, base+5 — meeting-ingest, base+6 — поддельные OpenAI и Telegram,
// base+7 — meeting-process (её дёргает смоук вместо pg_cron). fetch функций к api.openai.com и
// api.telegram.org подменяется предзагрузкой (--preload): ни OpenAI, ни людям ничего не уходит.
//
// Поддельный Whisper отвечает по имени файла части `spec-<метка>-<сегментов>-<задержка мс>-…`
// (или по тексту файла `<метка>:<сегментов>[:<задержка>]`) — так смоук знает, чья запись
// оказалась в стенограмме. Выгрузка претендента — настоящая форма .m4a (сервер меряет длину сам).
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-integrity-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

import { m4aOf } from "../supabase/functions/meeting-ingest/m4a-fixture.ts";

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4490");
const PORT_CLAIM = PORT_BASE + 4;
const PORT_INGEST = PORT_BASE + 5;
const PORT_FAKE = PORT_BASE + 6;
const PORT_PROCESS = PORT_BASE + 7;
const CRON_SECRET = "smoke-cron-secret";
const BUCKET = "meeting-audio";

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-in-${RUN}`;
const A = 940_000_000_000 + RUN * 10; // держатель встречи
const B = A + 1; // другой участник той же встречи
const PEOPLE = [A, B];
const EMAIL: Record<number, string> = {
  [A]: `a-${RUN}@smoke.test`,
  [B]: `b-${RUN}@smoke.test`,
};
const TOKEN: Record<number, string> = {
  [A]: `in-a-${RUN}`,
  [B]: `in-b-${RUN}`,
};
const AGENT = { id: `scriba-in-${RUN}`, token: `in-bot-${RUN}` };
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
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function whisperSpec(file: File, text: string): [string, number, number] {
  const byName = /spec-([a-z0-9]+)-(\d+)-(\d+)/i.exec(file.name);
  if (byName) return [byName[1] ?? "?", Number(byName[2]), Number(byName[3])];
  const [label = "?", count = "0", delay = "0"] = text.trim().split(":");
  return [label, Number(count) || 0, Number(delay) || 0];
}

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
      const form = await req.formData();
      const file = form.get("file");
      const [label, n, delay] = file instanceof File
        ? whisperSpec(
          file,
          file.name.endsWith(".m4a") && /spec-/.test(file.name)
            ? ""
            : await file.text(),
        )
        : ["?", 0, 0];
      await sleep(delay);
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
      await sleep(300);
    }
  }
  return false;
}

// ── Засев и уборка ──────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke integrity" }]);
  await rest(
    "POST",
    "allowed_users",
    await Promise.all(PEOPLE.map(async (id) => ({
      telegram_id: id,
      group_id: WS,
      added_by: A,
      email: EMAIL[id],
      recorder_token_hash: await sha256Hex(TOKEN[id] ?? ""),
    }))),
  );
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

async function listAll(prefix: string): Promise<string[]> {
  const res = await storage("POST", `object/list/${BUCKET}`, {
    prefix,
    limit: 1000,
  });
  const rows = res.ok
    ? await res.json() as Array<{ name: string; id: string | null }>
    : [];
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === null) out.push(...await listAll(`${prefix}/${r.name}`));
    else out.push(`${prefix}/${r.name}`);
  }
  return out;
}

async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const ids = [...createdMeetings];
  const paths = (await Promise.all(ids.map((id) => listAll(id)))).flat();
  if (paths.length > 0) {
    const res = await storage("DELETE", `object/${BUCKET}`, {
      prefixes: paths,
    });
    if (!res.ok) problems.push(`storage: ${res.status} ${await res.text()}`);
    else await res.body?.cancel();
  }
  const steps: string[] = [
    ...(ids.length > 0 ? [`meetings?id=in.(${ids.join(",")})`] : []),
    `service_agents?id=eq.${AGENT.id}`,
    `allowed_users?telegram_id=in.(${PEOPLE.join(",")})`,
    `workspaces?id=eq.${WS}`,
  ];
  for (const path of steps) {
    try {
      await rest("DELETE", path);
    } catch (e) {
      problems.push(String(e));
    }
  }
  return problems;
}

// ── Клиенты ─────────────────────────────────────────────────────────────────────

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

const recHeaders = (who: number) => ({ Authorization: `Bearer ${TOKEN[who]}` });
const botHeaders = {
  Authorization: `Bearer ${AGENT.token}`,
  "X-On-Behalf-Of": String(A),
};

/** Рекордер заявляется на стопе: календарная встреча с обоими в составе. */
async function claim(
  who: number,
  key: string,
  startedAt: string,
  seconds: number,
): Promise<Json> {
  const res = await post(
    PORT_CLAIM,
    { ...recHeaders(who), "Content-Type": "application/json" },
    JSON.stringify({
      identity_kind: "calendar",
      identity_key: key,
      title: "Quarter planning",
      started_at: startedAt,
      attendees: PEOPLE.map((p) => ({ name: `P${p}`, email: EMAIL[p] })),
      agent_version: "0.1.0",
      recorded_seconds: seconds,
    }),
  );
  if (typeof res.body.meeting_id === "string") {
    createdMeetings.add(res.body.meeting_id);
  }
  return { status: res.status, ...res.body };
}

/** Выгрузка текстовыми частями (длину сервер по ним не измерит): `метка:сегментов:задержка`. */
function textForm(
  meetingId: string,
  label: string,
  parts: Array<{ segments: number; delayMs?: number }>,
): FormData {
  const form = new FormData();
  form.append("meeting_id", meetingId);
  const name = (i: number) => `part-${String(i).padStart(3, "0")}`;
  form.append(
    "sys_parts",
    JSON.stringify(parts.map((_, i) => ({ name: name(i), offset: i * 600 }))),
  );
  parts.forEach((p, i) => {
    form.append(
      name(i),
      new File([`${label}:${p.segments}:${p.delayMs ?? 0}`], `${name(i)}.m4a`, {
        type: "audio/m4a",
      }),
    );
  });
  return form;
}

/** Выгрузка настоящей формы .m4a на `totalSeconds` частями по 15 минут; Whisper — по имени файла. */
function m4aForm(
  meetingId: string,
  label: string,
  totalSeconds: number,
  segmentsPerPart: number,
): FormData {
  const form = new FormData();
  form.append("meeting_id", meetingId);
  const starts: number[] = [];
  for (let at = 0; at < totalSeconds; at += 900) starts.push(at);
  const name = (i: number) => `part-${String(i).padStart(3, "0")}`;
  form.append(
    "sys_parts",
    JSON.stringify(starts.map((offset, i) => ({ name: name(i), offset }))),
  );
  starts.forEach((offset, i) => {
    const bytes = m4aOf(Math.min(900, totalSeconds - offset));
    form.append(
      name(i),
      new File([bytes], `spec-${label}-${segmentsPerPart}-0-p${i}.m4a`, {
        type: "audio/m4a",
      }),
    );
  });
  return form;
}

async function ingest(
  headers: Record<string, string>,
  form: FormData,
): Promise<{ status: number; body: Json }> {
  return await post(PORT_INGEST, headers, form);
}

// ── Наблюдение ──────────────────────────────────────────────────────────────────

interface Row {
  claim_owner: number | null;
  summary_status: string | null;
  processing_lease: string | null;
  recorded_seconds: number | null;
  recorders: Array<{ telegram_id: number; role: string }> | null;
  transcript: { segments?: Array<{ text: string }> } | null;
}

async function row(id: string): Promise<Row> {
  const [r] = await rest(
    "GET",
    `meetings?id=eq.${id}&select=claim_owner,summary_status,processing_lease,recorded_seconds,recorders,transcript`,
  ) as Row[];
  if (!r) throw new Error(`встреча ${id} пропала`);
  return r;
}

async function queuedExists(id: string): Promise<boolean> {
  return (await listAll(id)).some((p) =>
    p.slice(id.length + 1).startsWith("queued")
  );
}

function composition(r: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of r.transcript?.segments ?? []) {
    const label = s.text.split(" ")[0] ?? "?";
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

const roleOf = (r: Row, who: number) =>
  r.recorders?.find((x) => x.telegram_id === who)?.role;

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

async function settle(id: string, ms = 90_000): Promise<Row> {
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

function expectOnly(
  scene: string,
  r: Row,
  label: string,
  segments: number,
): void {
  const comp = composition(r);
  expect(
    `${scene}: стенограмма — только запись «${label}», ${segments} сегментов`,
    r.summary_status === "done" && Object.keys(comp).length === 1 &&
      comp[label] === segments,
    `status=${String(r.summary_status)} состав=${JSON.stringify(comp)}`,
  );
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const readyNotices = () =>
  inbox.filter((m) => m.text.includes("Тезисы встречи готовы")).length;

// Сцены разнесены по времени начала на 30+ минут: склейка по составу ищет встречу ±10 минут.

// P. Встреча записана рекордером A и опубликована команде; потом выгружает бот того же человека
// — запись полнее, но опубликованное не переписывается и повторно не объявляется.
async function scenePublished(): Promise<void> {
  const key = `cal:smoke-in-p-${RUN}`;
  const c = await claim(A, key, ago(20), 600);
  const id = String(c.meeting_id ?? "");
  await ingest(recHeaders(A), textForm(id, "a", [{ segments: 3 }]));
  const first = await settle(id);
  expectOnly("P (до публикации)", first, "a", 3);
  await rest("PATCH", `meetings?id=eq.${id}`, { status: "in_base" });
  const before = readyNotices();
  const bot = await ingest(
    botHeaders,
    textForm(id, "bot", [{ segments: 20 }, { segments: 20 }]),
  );
  const after = await settle(id);
  expectOnly("P (опубликована, бот выгрузил полнее)", after, "a", 3);
  expect(
    "P: по опубликованной встрече «тезисы готовы» повторно не рассылаются",
    readyNotices() === before,
    `было ${before}, стало ${readyNotices()}; ответ бота ${
      JSON.stringify(bot)
    }`,
  );
}

// K. A держит встречу с готовой стенограммой (6 сегментов, 10 минут). B записал дольше (40 минут),
// но распознано у него меньше: стенограмма остаётся за A — и владелец встречи тоже A.
async function sceneKept(): Promise<void> {
  const key = `cal:smoke-in-k-${RUN}`;
  const started = ago(60);
  const c = await claim(A, key, started, 600);
  const id = String(c.meeting_id ?? "");
  await ingest(recHeaders(A), textForm(id, "a", [{ segments: 6 }]));
  await settle(id);
  const cb = await claim(B, key, started, 2400);
  expect(
    "K: заявка B — та же встреча, B претендент",
    cb.meeting_id === id && cb.decision === "transcribe",
    JSON.stringify(cb),
  );
  const up = await ingest(recHeaders(B), m4aForm(id, "b", 2400, 1));
  const r = await settle(id);
  expectOnly("K (B длиннее, но беднее)", r, "a", 6);
  expect(
    "K: владелец встречи остался A — тот, чья стенограмма",
    r.claim_owner === A && roleOf(r, A) === "transcribe" &&
      roleOf(r, B) !== "transcribe",
    `claim_owner=${r.claim_owner} recorders=${
      JSON.stringify(r.recorders)
    } ответ=${JSON.stringify(up)}`,
  );
}

// T. A выгрузил (16 сегментов) и его запись ещё транскрибируется; B приходит с записью заметно
// длиннее, но беднее. Запись A не выбрасывается: сравнение по распознанному оставляет A.
async function sceneInFlight(): Promise<void> {
  const key = `cal:smoke-in-t-${RUN}`;
  const started = ago(100);
  const c = await claim(A, key, started, 600);
  const id = String(c.meeting_id ?? "");
  const upA = ingest(
    recHeaders(A),
    textForm(id, "a", [{ segments: 8, delayMs: 6000 }, {
      segments: 8,
      delayMs: 6000,
    }]),
  );
  await sleep(1500);
  const mid = await row(id);
  expect(
    "T: запись A в обработке, когда приходит B",
    mid.summary_status === "processing",
    JSON.stringify(mid.summary_status),
  );
  const cb = await claim(B, key, started, 2400);
  expect(
    "T: заявка B — та же встреча",
    cb.meeting_id === id && cb.decision === "transcribe",
    JSON.stringify(cb),
  );
  const upB = await ingest(recHeaders(B), m4aForm(id, "b", 2400, 1));
  await upA;
  const r = await settle(id);
  expectOnly("T (A в обработке и богаче, B длиннее)", r, "a", 16);
  expect(
    "T: владелец встречи остался A",
    r.claim_owner === A,
    `claim_owner=${r.claim_owner} ответ B=${JSON.stringify(upB)}`,
  );
}

// F. A выгрузил (3 сегмента, медленно), и его заявка истекла, пока запись обрабатывается. B
// заявляется и выгружает свою запись — она не повтор выгрузки A: сравнение оставляет более полную
// (B, 60 сегментов), и встреча у того, чья стенограмма.
async function sceneOtherPerson(): Promise<void> {
  const key = `cal:smoke-in-f-${RUN}`;
  const started = ago(140);
  const c = await claim(A, key, started, 600);
  const id = String(c.meeting_id ?? "");
  const upA = ingest(
    recHeaders(A),
    textForm(id, "a", [{ segments: 3, delayMs: 6000 }]),
  );
  await sleep(1500);
  await rest("PATCH", `meetings?id=eq.${id}`, { lease_expires_at: ago(1) });
  const cb = await claim(B, key, started, 2400);
  expect(
    "F: заявка B — та же встреча",
    cb.meeting_id === id && cb.decision === "transcribe",
    JSON.stringify(cb),
  );
  const upB = await ingest(recHeaders(B), m4aForm(id, "b", 2400, 20));
  await upA;
  const r = await settle(id);
  expectOnly("F (A обрабатывается с истёкшей заявкой, B полнее)", r, "b", 60);
  expect(
    "F: встреча у B — того, чья стенограмма",
    r.claim_owner === B,
    `claim_owner=${r.claim_owner} ответ B=${JSON.stringify(upB)}`,
  );
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
  ];
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_CLAIM, 60_000)) &&
      (await waitPort(PORT_INGEST, 60_000)) &&
      (await waitPort(PORT_PROCESS, 60_000));
    if (ready) {
      const only = Deno.env.get("SMOKE_ONLY") ?? "PKTF";
      for (
        const [tag, run] of [["P", scenePublished], ["K", sceneKept], [
          "T",
          sceneInFlight,
        ], ["F", sceneOtherPerson]] as const
      ) {
        if (!only.includes(tag)) continue;
        try {
          await run();
        } catch (e) {
          expect(`${tag}: сцена не упала`, false, String(e));
        }
      }
    }
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_CLAIM}/${PORT_INGEST}/${PORT_PROCESS}.`,
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
      : `КРАСНЫЙ: не сошлось ${failed} из ${checks.length}`,
  );
  Deno.exit(failed === 0 ? 0 : 1);
}

await main();
