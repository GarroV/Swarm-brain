#!/usr/bin/env -S deno run --allow-all
// Смоук автозапуска бота по календарю (T100): настоящие meeting-calendar и meeting-claim против
// локального контура Supabase, Google — поддельный.
//
// Проверяется путь «событие календаря → задание боту → claim» и его границы:
//   • задание заводится только людям, включившим автозапуск (allowed_users.scriba_autojoin);
//   • одна встреча у двоих коллег — одно задание, за первого; забирается ровно один раз, и два
//     одновременных прохода не заводят его дважды;
//   • всё, на что бот не пойдёт, приходит пропуском с причиной: не Meet, нет ссылки, календарь не
//     подключён, токен мёртв, бота уже позвали руками на ту же комнату;
//   • дверь — только токен агента: без токена 401, с X-On-Behalf-Of 403, не POST 405;
//   • бот заявляет встречу календарным ключом за владельца календаря — meeting-claim пускает (D016),
//     за человека, в чьём календаре этой встречи нет, — 403.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять: смоук
// заводит и удаляет строки.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Порты — от SMOKE_PORT_BASE (по умолчанию 4490; base..base+3 — сам контур): base+4 — функция
// meeting-calendar, base+5 — функция meeting-claim, base+6 — поддельный Google. Функции ходят в
// oauth2.googleapis.com и www.googleapis.com напрямую, поэтому fetch подменяется предзагрузкой
// (--preload) только для этих хостов.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-calendar-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4490");
const PORT_CALENDAR = PORT_BASE + 4;
const PORT_CLAIM = PORT_BASE + 5;
const PORT_FAKE = PORT_BASE + 6;

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-cal-${RUN}`;
const BASE_ID = 940_000_000_000 + RUN * 10;
// Порядок id важен: одна встреча у A и B уходит заданием за первого по telegram_id.
const PEOPLE = {
  a: BASE_ID + 1, // автозапуск, Meet + Zoom + событие без ссылки
  b: BASE_ID + 2, // автозапуск, та же встреча Meet, что у A
  c: BASE_ID + 3, // автозапуск, календарь не подключён
  d: BASE_ID + 4, // автозапуск, токен мёртв
  e: BASE_ID + 5, // автозапуск ВЫКЛЮЧЕН, своя встреча Meet
  f: BASE_ID + 6, // автозапуск, встреча Meet, куда бота уже позвали руками
} as const;
const AUTOJOIN = new Set<number>([
  PEOPLE.a,
  PEOPLE.b,
  PEOPLE.c,
  PEOPLE.d,
  PEOPLE.f,
]);
const AGENT = { id: `scriba-cal-${RUN}`, token: `cal-bot-${RUN}` };

type Json = Record<string, unknown>;
type FakeEvent = Json & {
  iCalUID: string;
  start: { dateTime: string };
  end: { dateTime: string };
};

const NOW = Date.now();
const iso = (offsetMin: number) =>
  new Date(NOW + offsetMin * 60_000).toISOString();
const keyOf = (ev: FakeEvent) =>
  `${ev.iCalUID}:${ev.start.dateTime.slice(0, 10)}`;

function ev(uid: string, extra: Json = {}): FakeEvent {
  return {
    id: uid,
    iCalUID: uid,
    summary: `Smoke ${uid}`,
    status: "confirmed",
    start: { dateTime: iso(1) },
    end: { dateTime: iso(30) },
    ...extra,
  };
}

const SHARED = ev(`shared-${RUN}`, {
  hangoutLink: "https://meet.google.com/smk-shrd-abc",
});
const ZOOM = ev(`zoom-${RUN}`, {
  location: "https://us02web.zoom.us/j/123456789",
});
const NOLINK = ev(`nolink-${RUN}`);
const OWN_E = ev(`own-e-${RUN}`, {
  hangoutLink: "https://meet.google.com/smk-owne-abc",
});
const MANUAL_ROOM = "https://meet.google.com/smk-manl-abc";
const MANUAL = ev(`manual-${RUN}`, { hangoutLink: MANUAL_ROOM });
const RACE = ev(`race-${RUN}`, {
  hangoutLink: "https://meet.google.com/smk-race-abc",
});

const calendars = new Map<number, FakeEvent[]>([
  [PEOPLE.a, [SHARED, ZOOM, NOLINK]],
  [PEOPLE.b, [SHARED]],
  [PEOPLE.d, [SHARED]],
  [PEOPLE.e, [OWN_E]],
  [PEOPLE.f, [MANUAL]],
]);
const refreshOf = (person: number) =>
  person === PEOPLE.d ? "rt-dead" : `rt-${person}`;

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

// ── Поддельный Google ───────────────────────────────────────────────────────────

function startFake(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT_FAKE,
    onListen: () => {},
  }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/token") {
      const form = new URLSearchParams(await req.text());
      const refresh = form.get("refresh_token") ?? "";
      if (refresh === "rt-dead") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ access_token: `at:${refresh}` });
    }
    if (url.pathname === "/calendar/v3/calendars/primary/events") {
      const token = (req.headers.get("Authorization") ?? "").replace(
        "Bearer at:rt-",
        "",
      );
      const events = calendars.get(Number(token)) ?? [];
      // Как Google: пересечение с окном — конец после timeMin, начало до timeMax.
      const min = Date.parse(url.searchParams.get("timeMin") ?? "");
      const max = Date.parse(url.searchParams.get("timeMax") ?? "");
      const items = events.filter((e) =>
        Date.parse(e.end.dateTime) > min && Date.parse(e.start.dateTime) < max
      );
      return Response.json({ items });
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
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke calendar" }]);
  await rest(
    "POST",
    "allowed_users",
    Object.values(PEOPLE).map((id) => ({
      telegram_id: id,
      group_id: WS,
      added_by: PEOPLE.a,
      email: `p${id}@smoke.test`,
      scriba_autojoin: AUTOJOIN.has(id),
    })),
  );
  await rest(
    "POST",
    "user_integrations",
    [PEOPLE.a, PEOPLE.b, PEOPLE.d, PEOPLE.e, PEOPLE.f].map((id) => ({
      telegram_id: id,
      service: "google_calendar",
      api_key: refreshOf(id),
    })),
  );
  await rest("POST", "service_agents", [{
    id: AGENT.id,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(AGENT.token),
  }]);
  await rest("POST", "meeting_invites", [{
    group_id: WS,
    invited_by: PEOPLE.f,
    join_url: MANUAL_ROOM,
    platform: "meet",
    expires_at: iso(15),
  }]);
}

async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const ids = Object.values(PEOPLE).join(",");
  const steps = [
    `meeting_calendar_jobs?group_id=eq.${WS}`,
    `meeting_invites?group_id=eq.${WS}`,
    `meetings?group_id=eq.${WS}`,
    `user_integrations?telegram_id=in.(${ids})`,
    `service_agents?id=eq.${AGENT.id}`,
    `allowed_users?telegram_id=in.(${ids})`,
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

// ── Ожидания ────────────────────────────────────────────────────────────────────

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: unknown): void {
  checks.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });
}

async function call(
  port: number,
  init: RequestInit = {},
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    ...init,
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})) as Json,
  };
}

const agentAuth = { Authorization: `Bearer ${AGENT.token}` };
type Skip = {
  invited_by: number;
  calendar_key: string | null;
  reason: string;
  platform?: string | null;
};
type Job = {
  id: string;
  calendar_key: string;
  invited_by: number;
  join_url: string;
  platform: string;
};

function skipsOf(body: Json): string[] {
  return ((body.skipped ?? []) as Skip[])
    .map((s) =>
      `${s.invited_by}|${s.calendar_key ?? "-"}|${s.reason}${
        s.platform ? `|${s.platform}` : ""
      }`
    )
    .sort();
}

const EXPECTED_SKIPS = [
  `${PEOPLE.a}|${keyOf(ZOOM)}|unsupported_platform|zoom`,
  `${PEOPLE.a}|${keyOf(NOLINK)}|no_conference_link`,
  `${PEOPLE.c}|-|calendar_not_connected`,
  `${PEOPLE.d}|-|calendar_token_dead`,
  `${PEOPLE.f}|${keyOf(MANUAL)}|manual_invite_exists|meet`,
].sort();

async function claimAs(
  person: number,
  key: string,
): Promise<{ status: number; body: Json }> {
  return await call(PORT_CLAIM, {
    headers: {
      ...agentAuth,
      "X-On-Behalf-Of": String(person),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity_kind: "calendar",
      identity_key: key,
      started_at: SHARED.start.dateTime,
      agent_version: "scriba-0",
      recorded_seconds: 0,
    }),
  });
}

async function scenario(): Promise<void> {
  // Дверь.
  expect("без токена — 401", (await call(PORT_CALENDAR)).status === 401);
  const spoof = await call(PORT_CALENDAR, {
    headers: { ...agentAuth, "X-On-Behalf-Of": String(PEOPLE.a) },
  });
  expect("X-On-Behalf-Of — 403", spoof.status === 403, spoof);
  const get = await fetch(`http://127.0.0.1:${PORT_CALENDAR}/`, {
    headers: agentAuth,
  });
  await get.body?.cancel();
  expect("не POST — 405", get.status === 405, get.status);

  // Первый проход.
  const first = await call(PORT_CALENDAR, { headers: agentAuth });
  expect("первый проход — 200", first.status === 200, first);
  const jobs = (first.body.jobs ?? []) as Job[];
  expect(
    "одна встреча у A и B — одно задание, за A (первого по id)",
    jobs.length === 1 && jobs[0].calendar_key === keyOf(SHARED) &&
      jobs[0].invited_by === PEOPLE.a,
    jobs,
  );
  expect(
    "ссылка и площадка задания — из события",
    jobs[0]?.join_url === SHARED.hangoutLink && jobs[0]?.platform === "meet",
    jobs[0],
  );
  expect(
    "пропуски громкие и с причиной",
    JSON.stringify(skipsOf(first.body)) === JSON.stringify(EXPECTED_SKIPS),
    {
      got: skipsOf(first.body),
      want: EXPECTED_SKIPS,
    },
  );
  expect(
    "человек без автозапуска не виден вовсе",
    !JSON.stringify(first.body).includes(String(PEOPLE.e)) &&
      !JSON.stringify(first.body).includes(keyOf(OWN_E)),
    first.body,
  );
  const rows = await rest(
    "GET",
    `meeting_calendar_jobs?group_id=eq.${WS}&select=calendar_key,taken_at,taken_by`,
  ) as Json[];
  expect(
    "в базе одно задание, забранное этим агентом",
    rows.length === 1 && rows[0].taken_at !== null &&
      rows[0].taken_by === AGENT.id,
    rows,
  );

  // Второй проход: забранное не возвращается, пропуски — те же.
  const second = await call(PORT_CALENDAR, { headers: agentAuth });
  expect(
    "второй проход — заданий нет",
    second.status === 200 && (second.body.jobs as Job[]).length === 0,
    second.body,
  );
  expect(
    "второй проход — те же пропуски",
    JSON.stringify(skipsOf(second.body)) === JSON.stringify(EXPECTED_SKIPS),
  );

  // Два одновременных прохода на новую встречу — одно задание на двоих.
  calendars.set(PEOPLE.b, [SHARED, RACE]);
  const [r1, r2] = await Promise.all([
    call(PORT_CALENDAR, { headers: agentAuth }),
    call(PORT_CALENDAR, { headers: agentAuth }),
  ]);
  const raced = [
    ...(r1.body.jobs as Job[] ?? []),
    ...(r2.body.jobs as Job[] ?? []),
  ];
  expect(
    "гонка двух проходов — задание одно и отдано одному",
    r1.status === 200 && r2.status === 200 && raced.length === 1 &&
      raced[0].calendar_key === keyOf(RACE),
    { r1: r1.body.jobs, r2: r2.body.jobs },
  );
  const raceRows = await rest(
    "GET",
    `meeting_calendar_jobs?group_id=eq.${WS}&calendar_key=eq.${keyOf(RACE)}`,
  ) as Json[];
  expect("в базе строка гонки одна", raceRows.length === 1, raceRows);

  // Бот заявляет встречу календарным ключом.
  const ok = await claimAs(PEOPLE.a, keyOf(SHARED));
  expect(
    "claim за владельца календаря — пускает",
    ok.status === 200 && typeof ok.body.meeting_id === "string",
    ok,
  );
  const foreign = await claimAs(PEOPLE.e, keyOf(SHARED));
  expect(
    "claim за человека без этой встречи в календаре — 403",
    foreign.status === 403,
    foreign,
  );
  const noCalendar = await claimAs(PEOPLE.c, keyOf(SHARED));
  expect(
    "claim за человека без календаря — 403",
    noCalendar.status === 403,
    noCalendar,
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
    spawnFunction(
      "../supabase/functions/meeting-calendar/index.ts",
      PORT_CALENDAR,
    ),
    spawnFunction("../supabase/functions/meeting-claim/index.ts", PORT_CLAIM),
  ];
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_CALENDAR, 30_000)) &&
      (await waitPort(PORT_CLAIM, 30_000));
    if (ready) await scenario();
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_CALENDAR}/${PORT_CLAIM} за 30 с.`,
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
