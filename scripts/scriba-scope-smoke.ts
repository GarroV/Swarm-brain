#!/usr/bin/env -S deno run --allow-all
// Смоук «пропуск бота на одну встречу» (T165) против настоящих функций и настоящей базы.
//
// Бот за человека ходит только пропуском, который сервер выдал сам, когда оркестратор забрал
// приглашение (D017) или задание автозапуска (D021). Проверяется граница пропуска в каждой двери:
//   • meeting-invite выдаёт пропуск к каждому забранному приглашению; сам пропуск эту дверь не открывает;
//   • токен агента за человека не действует ни в одной двери — с X-On-Behalf-Of и без;
//   • заявка по пропуску — только встреча своего приглашения; комнатную встречу бот не заводит;
//     календарную — не заводит, пока человек не включил автозапуск;
//   • heartbeat, статус и уведомления — только по встрече своего пропуска, даже если другая
//     встреча того же человека;
//   • уведомление до встречи несёт название из пропуска, а не присланное;
//   • рекордер человека (его личный токен) ничего из этого не замечает.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять:
// смоук заводит и удаляет строки.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Порты — от SMOKE_PORT_BASE (по умолчанию 4490; base..base+3 — сам контур): base+4 meeting-invite,
// base+5 meeting-claim, base+6 meeting-heartbeat, base+7 meeting-status, base+8 meeting-notice,
// base+9 — поддельный Telegram (fetch функции уведомлений подменяется предзагрузкой).
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-scope-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4490");
const PORT = {
  invite: PORT_BASE + 4,
  claim: PORT_BASE + 5,
  heartbeat: PORT_BASE + 6,
  status: PORT_BASE + 7,
  notice: PORT_BASE + 8,
  fake: PORT_BASE + 9,
};

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-scope-${RUN}`;
const A = 940_000_000_000 + RUN * 10;
const B = A + 1;
const A_RECORDER = `scope-rec-${RUN}`;
const AGENT = { id: `scriba-scope-${RUN}`, token: `scope-bot-${RUN}` };
const CAL_KEY = `scope-${RUN}@google.com:2026-09-28`;
const SERVER_TITLE = `Server title ${RUN}`;
const BODY_TITLE = `Body title ${RUN}`;

type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

// ── Поддельный Telegram и функции ───────────────────────────────────────────────

const inbox: Array<{ chat_id: number; text: string }> = [];

function startFake(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT.fake,
    onListen: () => {},
  }, async (req) => {
    if (new URL(req.url).pathname.endsWith("/sendMessage")) {
      const body = await req.json().catch(() => ({}));
      inbox.push({
        chat_id: Number(body.chat_id),
        text: String(body.text ?? ""),
      });
      return Response.json({ ok: true, result: { message_id: inbox.length } });
    }
    return new Response("not found", { status: 404 });
  });
}

const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = "https://api.telegram.org";
  if (url.startsWith(host + "/")) return real(url.replace(host, "http://127.0.0.1:${PORT.fake}"), init);
  return real(input, init);
};`)
}`;

function spawnFunction(name: string, port: number): Deno.ChildProcess {
  return new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      `--preload=${PRELOAD}`,
      new URL(`../supabase/functions/${name}/index.ts`, import.meta.url)
        .pathname,
    ],
    env: {
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      TELEGRAM_BOT_TOKEN: "smoke-telegram-token",
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

async function call(
  port: number,
  token: string,
  body: Json | null,
  opts: { onBehalfOf?: number; query?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.onBehalfOf !== undefined) {
    headers["X-On-Behalf-Of"] = String(opts.onBehalfOf);
  }
  const res = await fetch(`http://127.0.0.1:${port}/${opts.query ?? ""}`, {
    method: body === null ? "GET" : "POST",
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})) as Json,
  };
}

// ── Засев и уборка ──────────────────────────────────────────────────────────────

const joinUrl = (n: number) =>
  `https://meet.google.com/scp-${String(RUN)}-${String(n)}`;
const createdMeetings = new Set<string>();

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke scope" }]);
  await rest("POST", "allowed_users", [{
    telegram_id: A,
    group_id: WS,
    added_by: A,
    recorder_token_hash: await sha256Hex(A_RECORDER),
  }]);
  await rest("POST", "allowed_users", [{
    telegram_id: B,
    group_id: WS,
    added_by: A,
  }]);
  await rest("POST", "service_agents", [{
    id: AGENT.id,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(AGENT.token),
  }]);
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  // Три приглашения по порядку: два от A, одно от B. meeting-invite отдаёт старые первыми.
  for (const [n, who] of [[1, A], [2, A], [3, B]] as const) {
    await rest("POST", "meeting_invites", [{
      group_id: WS,
      invited_by: who,
      join_url: joinUrl(n),
      platform: "meet",
      expires_at: expires,
      created_at: new Date(Date.now() - (10 - n) * 1000).toISOString(),
    }]);
  }
}

/** Календарный пропуск засевается напрямую: выдачу по заданию проверяет scriba-calendar-smoke. */
async function seedCalendarGrant(): Promise<string> {
  const now = Date.now();
  const [job] = await rest("POST", "meeting_calendar_jobs", [{
    group_id: WS,
    calendar_key: CAL_KEY,
    invited_by: A,
    join_url: joinUrl(9),
    platform: "meet",
    title: SERVER_TITLE,
    starts_at: new Date(now).toISOString(),
    ends_at: new Date(now + 30 * 60_000).toISOString(),
    taken_at: new Date(now).toISOString(),
    taken_by: AGENT.id,
  }]) as Array<{ id: string }>;
  const token = `sgr_scope_${String(RUN)}_${crypto.randomUUID()}`;
  await rest("POST", "meeting_agent_grants", [{
    token_hash: await sha256Hex(token),
    agent_id: AGENT.id,
    group_id: WS,
    telegram_id: A,
    calendar_job_id: job.id,
    calendar_key: CAL_KEY,
    join_url: joinUrl(9),
    title: SERVER_TITLE,
    expires_at: new Date(now + 60 * 60_000).toISOString(),
  }]);
  return token;
}

async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const ids = [...createdMeetings];
  const steps: string[] = [
    `meeting_agent_grants?group_id=eq.${WS}`,
    `meeting_notices?recipient_id=in.(${String(A)},${String(B)})`,
    `meeting_invites?group_id=eq.${WS}`,
    `meeting_calendar_jobs?group_id=eq.${WS}`,
    ...(ids.length > 0 ? [`meetings?id=in.(${ids.join(",")})`] : []),
    `service_agents?id=eq.${AGENT.id}`,
    `allowed_users?telegram_id=in.(${String(A)},${String(B)})`,
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

// ── Сценарий ────────────────────────────────────────────────────────────────────

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: unknown): void {
  checks.push({
    name,
    ok,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

const startedAt = () => new Date().toISOString();

function manualClaim(invite: Json): Json {
  return {
    identity_kind: "manual",
    identity_key: `scriba:${crypto.randomUUID()}`,
    started_at: startedAt(),
    agent_version: "scriba-1",
    recorded_seconds: 0,
    invite_id: invite.id,
    join_url: invite.join_url,
  };
}

function beat(meetingId: string): Json {
  return {
    recording: true,
    version: 1,
    on_call: true,
    meeting_key: `manual:${meetingId}`,
    meeting_id: meetingId,
  };
}

async function scenario(): Promise<void> {
  // 1. Забор приглашений: к каждому — свой пропуск.
  const taken = await call(PORT.invite, AGENT.token, {});
  const invites = (taken.body.invites ?? []) as Json[];
  const grants = invites.map((i) => String(i.grant_token ?? ""));
  expect(
    "meeting-invite: к каждому забранному приглашению — свой пропуск sgr_",
    taken.status === 200 && invites.length === 3 &&
      grants.every((g) => g.startsWith("sgr_")) &&
      new Set(grants).size === 3,
    taken,
  );
  if (invites.length !== 3) return;
  const [invA1, invA2, invB] = invites;
  const [gA1, gA2, gB] = grants;
  expect(
    "порядок приглашений: A, A, B",
    [invA1, invA2, invB].map((i) => i.invited_by).join() === [A, A, B].join(),
  );

  const byGrant = await call(PORT.invite, gA1, {});
  expect(
    "пропуск не открывает дверь оркестратора meeting-invite (401)",
    byGrant.status === 401,
    byGrant,
  );

  // 2. Токен агента за человека — нигде.
  const wsClaim = await call(PORT.claim, AGENT.token, manualClaim(invA1), {
    onBehalfOf: A,
  });
  expect(
    "токен агента + X-On-Behalf-Of: заявка — 403",
    wsClaim.status === 403,
    wsClaim,
  );
  const wsBare = await call(PORT.claim, AGENT.token, manualClaim(invA1));
  expect(
    "токен агента без заголовка: заявка — 403",
    wsBare.status === 403,
    wsBare,
  );

  // 3. Заявки по пропуску.
  const foreign = await call(PORT.claim, gA2, manualClaim(invA1));
  expect(
    "пропуск другого приглашения того же человека: заявка — 403",
    foreign.status === 403,
    foreign,
  );
  const room = await call(PORT.claim, gA1, {
    identity_kind: "room",
    identity_key: `meet:scp-${String(RUN)}-1`,
    started_at: startedAt(),
    recorded_seconds: 0,
  });
  expect("комнатная встреча по пропуску — 403", room.status === 403, room);
  const mismatch = await call(PORT.claim, gA1, manualClaim(invA1), {
    onBehalfOf: B,
  });
  expect(
    "пропуск A с X-On-Behalf-Of другого человека — 403",
    mismatch.status === 403,
    mismatch,
  );

  const claimA1 = await call(PORT.claim, gA1, manualClaim(invA1), {
    onBehalfOf: A,
  });
  const mA1 = String(claimA1.body.meeting_id ?? "");
  expect(
    "пропуск A1: ручная встреча своего приглашения — 200",
    claimA1.status === 200 && mA1 !== "",
    claimA1,
  );
  const claimA2 = await call(PORT.claim, gA2, manualClaim(invA2));
  const mA2 = String(claimA2.body.meeting_id ?? "");
  expect(
    "пропуск A2: вторая встреча того же человека — 200",
    claimA2.status === 200 && mA2 !== "",
    claimA2,
  );
  const claimB = await call(PORT.claim, gB, manualClaim(invB));
  const mB = String(claimB.body.meeting_id ?? "");
  expect(
    "пропуск B: встреча B — 200",
    claimB.status === 200 && mB !== "",
    claimB,
  );
  for (const id of [mA1, mA2, mB]) if (id) createdMeetings.add(id);
  if (!mA1 || !mA2 || !mB) return;

  const again = await call(PORT.claim, gA1, manualClaim(invA2));
  expect(
    "привязанный пропуск A1 не заявляет встречу A2 — 403",
    again.status === 403,
    again,
  );
  const rows = await rest(
    "GET",
    `meeting_agent_grants?group_id=eq.${WS}&select=invite_id,meeting_id`,
  ) as Json[];
  const bound = Object.fromEntries(
    rows.map((r) => [String(r.invite_id), String(r.meeting_id)]),
  );
  expect(
    "в базе каждый пропуск привязан к встрече своей заявки",
    bound[String(invA1.id)] === mA1 && bound[String(invA2.id)] === mA2 &&
      bound[String(invB.id)] === mB,
    rows,
  );

  // 4. Heartbeat.
  const hbOwn = await call(PORT.heartbeat, gA1, beat(mA1));
  expect("heartbeat по своей встрече — 200", hbOwn.status === 200, hbOwn);
  const hbSibling = await call(PORT.heartbeat, gA1, beat(mA2));
  expect(
    "heartbeat пропуском A1 по другой встрече того же A — 403",
    hbSibling.status === 403,
    hbSibling,
  );
  const hbWs = await call(PORT.heartbeat, AGENT.token, beat(mA1), {
    onBehalfOf: A,
  });
  expect(
    "heartbeat токеном агента + X-On-Behalf-Of — 403",
    hbWs.status === 403,
    hbWs,
  );

  // 5. Статус.
  const q = `?ids=${mA1},${mA2}`;
  const stGrant = await call(PORT.status, gA1, null, { query: q });
  const grantIds = ((stGrant.body.statuses ?? []) as Json[]).map((s) => s.id);
  expect(
    "статус по пропуску A1 — только его встреча",
    stGrant.status === 200 && grantIds.join() === mA1,
    stGrant,
  );
  const stHuman = await call(PORT.status, A_RECORDER, null, { query: q });
  expect(
    "статус рекордером A — обе его встречи (людей пропуск не касается)",
    stHuman.status === 200 &&
      ((stHuman.body.statuses ?? []) as Json[]).length === 2,
    stHuman,
  );
  const stWs = await call(PORT.status, AGENT.token, null, {
    query: q,
    onBehalfOf: A,
  });
  expect(
    "статус токеном агента + X-On-Behalf-Of — 403",
    stWs.status === 403,
    stWs,
  );

  // 6. Уведомления.
  const nOther = await call(PORT.notice, gA1, {
    kind: "no_audio",
    meeting_id: mA2,
  });
  expect(
    "уведомление пропуском A1 о встрече A2 — 403",
    nOther.status === 403,
    nOther,
  );
  const nWs = await call(PORT.notice, AGENT.token, {
    kind: "no_audio",
    meeting_id: mA1,
  }, { onBehalfOf: A });
  expect(
    "уведомление токеном агента + X-On-Behalf-Of — 403",
    nWs.status === 403,
    nWs,
  );
  const before = inbox.length;
  const nOwn = await call(PORT.notice, gA1, {
    kind: "no_audio",
    meeting_id: mA1,
  });
  expect(
    "уведомление о своей встрече — 200 и доходит до A",
    nOwn.status === 200 && inbox.slice(before).some((m) => m.chat_id === A),
    { nOwn, inbox: inbox.slice(before) },
  );

  // 7. Календарный пропуск: автозапуск выключен, название — из пропуска.
  const gCal = await seedCalendarGrant();
  const calClaim = await call(PORT.claim, gCal, {
    identity_kind: "calendar",
    identity_key: CAL_KEY,
    started_at: startedAt(),
    agent_version: "scriba-1",
    recorded_seconds: 0,
  });
  expect(
    "календарная заявка, пока у человека выключен автозапуск — 403",
    calClaim.status === 403,
    calClaim,
  );
  const nKey = await call(PORT.notice, gCal, {
    kind: "no_owner",
    meeting_key: `other-${CAL_KEY}`,
  });
  expect(
    "уведомление до встречи о чужом событии — 403",
    nKey.status === 403,
    nKey,
  );
  const beforeCal = inbox.length;
  const nCal = await call(PORT.notice, gCal, {
    kind: "no_owner",
    meeting_key: CAL_KEY,
    title: BODY_TITLE,
  });
  const sent = inbox.slice(beforeCal).filter((m) => m.chat_id === A);
  expect(
    "уведомление до встречи: название из пропуска, присланное не доходит",
    nCal.status === 200 && sent.some((m) => m.text.includes(SERVER_TITLE)) &&
      !sent.some((m) => m.text.includes(BODY_TITLE)),
    { nCal, sent },
  );

  // 8. Рекордер человека — как раньше.
  const recRoom = await call(PORT.claim, A_RECORDER, {
    identity_kind: "room",
    identity_key: `meet:scp-${String(RUN)}-rec`,
    started_at: startedAt(),
    recorded_seconds: 60,
  });
  const mRec = String(recRoom.body.meeting_id ?? "");
  if (mRec) createdMeetings.add(mRec);
  expect(
    "рекордер человека заводит комнатную встречу — 200",
    recRoom.status === 200 && mRec !== "",
    recRoom,
  );
  const recBeat = await call(PORT.heartbeat, A_RECORDER, beat(mA2));
  expect(
    "рекордер человека стучится по любой своей встрече — не 403",
    recBeat.status !== 403,
    recBeat,
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
    spawnFunction("meeting-invite", PORT.invite),
    spawnFunction("meeting-claim", PORT.claim),
    spawnFunction("meeting-heartbeat", PORT.heartbeat),
    spawnFunction("meeting-status", PORT.status),
    spawnFunction("meeting-notice", PORT.notice),
  ];
  const ports = [
    PORT.invite,
    PORT.claim,
    PORT.heartbeat,
    PORT.status,
    PORT.notice,
  ];
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await Promise.all(ports.map((p) => waitPort(p, 30_000)))).every(
      Boolean,
    );
    if (ready) await scenario();
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${ports.join("/")} за 30 с.`,
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
