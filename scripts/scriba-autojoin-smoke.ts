#!/usr/bin/env -S deno run --allow-all
// Смоук переключателя автозапуска (D021, T161): настоящие swarm-api и meeting-calendar против
// локального контура Supabase, Google — поддельный.
//
// Проверяется:
//   • человек выключает автозапуск себе через веб (PUT /scriba/autojoin) — флаг в базе меняется,
//     GET отдаёт его же; чужой id в теле не действует (флаг коллеги не тронут);
//   • выключение гасит уже заведённые, но не забранные задания: опрос оркестратора их не отдаёт и
//     удаляет; забранные не трогаются;
//   • у коллеги та же встреча, а задание было заведено за выключившего — опрос отдаёт его за коллегу
//     (ключ встречи не держится выключившим).
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями (прод не подставлять: смоук
// заводит и удаляет строки).
//   SMOKE_SUPABASE_URL · SMOKE_SERVICE_KEY — как у scripts/scriba-calendar-smoke.ts
//   SMOKE_PORT_BASE (по умолчанию 4450): base+4 — meeting-calendar, base+5 — swarm-api,
//   base+6 — поддельный Google.
// Красный, если хоть одно ожидание не сошлось или окружения нет.
import { signJWT } from "../supabase/functions/_shared/jwt.ts";

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4450");
const PORT_CALENDAR = PORT_BASE + 4;
const PORT_API = PORT_BASE + 5;
const PORT_FAKE = PORT_BASE + 6;
const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";
const JWT_SECRET = `smoke-jwt-${crypto.randomUUID()}`;

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-aj-${RUN}`;
const BASE_ID = 950_000_000_000 + RUN * 10;
// X раньше Y по telegram_id: общая встреча без выключения ушла бы за X.
const X = BASE_ID + 1; // выключит автозапуск; общая встреча с Y
const Y = BASE_ID + 2; // автозапуск включён; та же встреча
const Z = BASE_ID + 3; // выключит; своя встреча (незабранное задание) и забранное задание
const AGENT = { id: `scriba-aj-${RUN}`, token: `aj-bot-${RUN}` };

type Json = Record<string, unknown>;
const NOW = Date.now();
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString();
const SHARED = {
  id: `sh-${RUN}`,
  iCalUID: `sh-${RUN}`,
  summary: "Smoke shared",
  status: "confirmed",
  start: { dateTime: iso(1) },
  end: { dateTime: iso(30) },
  hangoutLink: "https://meet.google.com/aj-shrd-abc",
};
const SHARED_KEY = `${SHARED.iCalUID}:${SHARED.start.dateTime.slice(0, 10)}`;
const calendars = new Map<number, Json[]>([[X, [SHARED]], [Y, [SHARED]], [
  Z,
  [],
]]);

async function sha256Hex(v: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
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

function startFake(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT_FAKE,
    onListen: () => {},
  }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/token") {
      const refresh =
        new URLSearchParams(await req.text()).get("refresh_token") ?? "";
      return Response.json({ access_token: `at:${refresh}` });
    }
    if (url.pathname === "/calendar/v3/calendars/primary/events") {
      const who = Number(
        (req.headers.get("Authorization") ?? "").replace("Bearer at:rt-", ""),
      );
      return Response.json({ items: calendars.get(who) ?? [] });
    }
    return new Response("not found", { status: 404 });
  });
}

const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const host of ["https://oauth2.googleapis.com", "https://www.googleapis.com"]) {
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
      GOOGLE_CLIENT_ID: "smoke-client",
      GOOGLE_CLIENT_SECRET: "smoke-secret",
      WEB_JWT_SECRET: JWT_SECRET,
      TELEGRAM_BOT_TOKEN: "smoke-telegram",
      OPENAI_API_KEY: "smoke-openai",
      MINIAPP_ORIGIN: "http://localhost",
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

async function waitPort(port: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

function job(invitedBy: number, key: string, extra: Json = {}): Json {
  return {
    group_id: WS,
    calendar_key: key,
    invited_by: invitedBy,
    join_url: "https://meet.google.com/aj-shrd-abc",
    platform: "meet",
    title: "Smoke",
    starts_at: iso(1),
    ends_at: iso(30),
    ...extra,
  };
}

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke autojoin" }]);
  await rest(
    "POST",
    "allowed_users",
    [X, Y, Z].map((id) => ({
      telegram_id: id,
      group_id: WS,
      added_by: X,
      email: `p${id}@smoke.test`,
      scriba_autojoin: true,
    })),
  );
  await rest(
    "POST",
    "user_integrations",
    [X, Y, Z].map((id) => ({
      telegram_id: id,
      service: "google_calendar",
      api_key: `rt-${id}`,
    })),
  );
  await rest("POST", "service_agents", [{
    id: AGENT.id,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(AGENT.token),
  }]);
  // Задания, заведённые прошлым опросом, пока все были включены.
  await rest("POST", "meeting_calendar_jobs", [
    job(X, SHARED_KEY),
    job(Z, `own-z-${RUN}:x`, {
      join_url: "https://meet.google.com/aj-ownz-abc",
    }),
    job(Z, `taken-z-${RUN}:x`, {
      join_url: "https://meet.google.com/aj-tknz-abc",
      taken_at: iso(-1),
    }),
  ]);
}

async function cleanup(): Promise<string[]> {
  const ids = [X, Y, Z].join(",");
  const problems: string[] = [];
  for (
    const path of [
      `meeting_calendar_misses?group_id=eq.${WS}`,
      `meeting_calendar_jobs?group_id=eq.${WS}`,
      `user_integrations?telegram_id=in.(${ids})`,
      `service_agents?id=eq.${AGENT.id}`,
      `allowed_users?telegram_id=in.(${ids})`,
      `workspaces?id=eq.${WS}`,
    ]
  ) {
    try {
      await rest("DELETE", path);
    } catch (e) {
      problems.push(String(e));
    }
  }
  return problems;
}

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: unknown): void {
  checks.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });
}

async function api(
  person: number,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${PORT_API}/scriba/autojoin`, {
    method,
    headers: {
      Authorization: `Bearer ${await signJWT(
        { telegram_id: person },
        JWT_SECRET,
      )}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Json };
}

async function flag(person: number): Promise<unknown> {
  const rows = await rest(
    "GET",
    `allowed_users?telegram_id=eq.${person}&select=scriba_autojoin`,
  ) as Json[];
  return rows[0]?.scriba_autojoin;
}

async function scenario(): Promise<void> {
  const before = await api(X, "GET");
  expect(
    "GET — свой флаг (включён засевом)",
    before.status === 200 && before.body.enabled === true,
    before,
  );

  const off = await api(X, "PUT", { enabled: false, telegram_id: Y });
  expect(
    "PUT enabled=false — 200 { enabled:false }",
    off.status === 200 && off.body.enabled === false,
    off,
  );
  expect("флаг X в базе выключен", (await flag(X)) === false, await flag(X));
  expect(
    "ПРАВА: чужой id в теле не действует — флаг Y включён",
    (await flag(Y)) === true,
    await flag(Y),
  );
  const zOff = await api(Z, "PUT", { enabled: false });
  expect("Z выключил", zOff.status === 200 && (await flag(Z)) === false, zOff);
  const bad = await api(X, "PUT", { enabled: "no" });
  expect(
    "PUT без булева — 400 invalid_body",
    bad.status === 400 && bad.body.code === "invalid_body",
    bad,
  );

  const res = await fetch(`http://127.0.0.1:${PORT_CALENDAR}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AGENT.token}` },
  });
  const body = await res.json() as { jobs?: Json[] };
  const taken = (body.jobs ?? []).map((j) => [j.invited_by, j.calendar_key]);
  expect(
    "опрос отдаёт общую встречу за Y, и только её",
    res.status === 200 &&
      JSON.stringify(taken) === JSON.stringify([[Y, SHARED_KEY]]),
    body,
  );

  const rows = await rest(
    "GET",
    `meeting_calendar_jobs?group_id=eq.${WS}&select=calendar_key,invited_by,taken_at`,
  ) as Json[];
  const keys = rows.map((r) => r.calendar_key).sort();
  expect(
    "незабранное задание Z погашено",
    !keys.includes(`own-z-${RUN}:x`),
    rows,
  );
  expect(
    "забранное задание Z не тронуто",
    keys.includes(`taken-z-${RUN}:x`),
    rows,
  );
  const shared = rows.find((r) => r.calendar_key === SHARED_KEY);
  expect(
    "задание общей встречи — за Y и забрано",
    shared?.invited_by === Y && shared?.taken_at !== null,
    rows,
  );

  const on = await api(X, "PUT", { enabled: true });
  expect(
    "включение обратно — флаг X в базе включён",
    on.status === 200 && (await flag(X)) === true,
    on,
  );
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "КРАСНЫЙ: нет SMOKE_SUPABASE_URL / SMOKE_SERVICE_KEY — смоук не выполнялся.",
    );
    Deno.exit(1);
  }
  const fake = startFake();
  const fns = [
    spawnFunction(
      "../supabase/functions/meeting-calendar/index.ts",
      PORT_CALENDAR,
    ),
    spawnFunction("../supabase/functions/swarm-api/index.ts", PORT_API),
  ];
  let ready = false;
  let problems: string[] = [];
  try {
    await seed();
    ready = (await waitPort(PORT_CALENDAR, 60_000)) &&
      (await waitPort(PORT_API, 60_000));
    if (ready) await scenario();
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    problems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_CALENDAR}/${PORT_API} за 60 с.`,
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
  for (const p of problems) console.log(`✘ уборка: ${p}`);
  const failed = checks.filter((c) => !c.ok).length + problems.length;
  console.log(
    failed === 0
      ? `ЗЕЛЁНЫЙ: ${String(checks.length)} ожиданий`
      : `КРАСНЫЙ: не сошлось ${String(failed)}`,
  );
  Deno.exit(failed === 0 ? 0 : 1);
}

await main();
