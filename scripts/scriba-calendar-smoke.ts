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
// Пропуски (T102, D022): громкие причины прохода и «бот забрал задание и не дошёл» записываются в
// meeting_calendar_misses один раз; рекордер под своим токеном (meeting-missed) видит свои пропуски,
// в том числе встречу, которую служба автозапуска не подхватила вовсе, и зовёт бота руками одним
// действием — заводится приглашение D017, пропуск закрыт им. Чужой пропуск — 404, не рекордер — 403.
//
// Снимок календаря (T164, D023): рекордер в Google не ходит — календарь снимает по расписанию
// meeting-calendar-snapshot (дверь — X-Cron-Secret), meeting-missed читает только снимок. Проверяется:
// до первого снимка checked=false; ни один запрос рекордера не дёргает Google (счётчик поддельного
// Google); встреча, поставленная после снимка, не видна до следующего; Google моргнул на снимке —
// прежний снимок в силе, snapshot_at не сдвинулся.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase с накатанными миграциями. Прод сюда не подставлять: смоук
// заводит и удаляет строки.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Порты — от SMOKE_PORT_BASE (по умолчанию 4490; base..base+3 — сам контур): base+4 — функция
// meeting-calendar, base+5 — функция meeting-claim, base+6 — поддельный Google, base+7 — meeting-missed,
// base+8 — meeting-calendar-snapshot. Функции ходят в
// oauth2.googleapis.com и www.googleapis.com напрямую, поэтому fetch подменяется предзагрузкой
// (--preload) только для этих хостов.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-calendar-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4490");
const PORT_CALENDAR = PORT_BASE + 4;
const PORT_CLAIM = PORT_BASE + 5;
const PORT_FAKE = PORT_BASE + 6;
const PORT_MISSED = PORT_BASE + 7;
const PORT_SNAPSHOT = PORT_BASE + 8;
const CRON_SECRET = `smoke-cron-${crypto.randomUUID()}`;

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
  g: BASE_ID + 7, // автозапуск, рекордер: идущие встречи, которые служба не подхватила
  h: BASE_ID + 8, // автозапуск ВЫКЛЮЧЕН, рекордер
} as const;
const AUTOJOIN = new Set<number>([
  PEOPLE.a,
  PEOPLE.b,
  PEOPLE.c,
  PEOPLE.d,
  PEOPLE.f,
  PEOPLE.g,
]);
/** Токены рекордера и MCP (для отказа) — по человеку. */
const recorderToken = (person: number) => `rec-${RUN}-${person}`;
const mcpToken = (person: number) => `mcp-${RUN}-${person}`;
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
// Бот забрал задание, пришёл к двери и сам сказал человеку (нотиса) — это не пропуск.
const TOLD = ev(`told-${RUN}`, {
  hangoutLink: "https://meet.google.com/smk-told-abc",
});
// Идущие встречи G: начались 12 минут назад — вне окна оркестратора, задания на них нет.
const ORPHAN_ROOM = "https://meet.google.com/smk-orph-abc";
const ORPHAN = ev(`orphan-${RUN}`, {
  hangoutLink: ORPHAN_ROOM,
  start: { dateTime: iso(-12) },
  end: { dateTime: iso(40) },
});
const LOSTBOT = ev(`lostbot-${RUN}`, {
  hangoutLink: "https://meet.google.com/smk-lost-abc",
  start: { dateTime: iso(-12) },
  end: { dateTime: iso(40) },
});
const ZOOM_NOW = ev(`zoomnow-${RUN}`, {
  location: "https://us02web.zoom.us/j/987654321",
  start: { dateTime: iso(-12) },
  end: { dateTime: iso(40) },
});

const calendars = new Map<number, FakeEvent[]>([
  [PEOPLE.a, [SHARED, ZOOM, NOLINK]],
  [PEOPLE.b, [SHARED]],
  [PEOPLE.d, [SHARED]],
  [PEOPLE.e, [OWN_E]],
  [PEOPLE.f, [MANUAL]],
  [PEOPLE.g, [ORPHAN, LOSTBOT, ZOOM_NOW]],
]);
/** Запросы в поддельный Google (токен + события) и человек, у которого Google «лежит». */
const google = { hits: 0, downFor: null as number | null };
/** Запросы в Google, пришедшиеся на вызовы meeting-missed (claim бота ходит в календарь законно). */
let recorderGoogleHits = 0;
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
    google.hits += 1;
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
      if (Number(token) === google.downFor) {
        return new Response("backend error", { status: 503 });
      }
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
  for (const id of Object.values(PEOPLE)) {
    await rest("PATCH", `allowed_users?telegram_id=eq.${id}`, {
      recorder_token_hash: await sha256Hex(recorderToken(id)),
      recorder_token_expires_at: iso(60 * 24),
      claude_mcp_token_hash: await sha256Hex(mcpToken(id)),
      claude_mcp_token_expires_at: iso(60 * 24),
    });
  }
  await rest(
    "POST",
    "user_integrations",
    [PEOPLE.a, PEOPLE.b, PEOPLE.d, PEOPLE.e, PEOPLE.f, PEOPLE.g].map((id) => ({
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
    `meeting_calendar_misses?group_id=eq.${WS}`,
    `meeting_calendar_snapshot_events?group_id=eq.${WS}`,
    `meeting_calendar_snapshot_runs?group_id=eq.${WS}`,
    `meeting_notices?recipient_id=in.(${ids})`,
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

// ── Пропуски (T102) ─────────────────────────────────────────────────────────────

type MissRow = {
  invited_by: number;
  miss_key: string;
  reason: string;
  invite_id: string | null;
};

async function missesInDb(): Promise<string[]> {
  const rows = await rest(
    "GET",
    `meeting_calendar_misses?group_id=eq.${WS}&select=invited_by,miss_key,reason,invite_id`,
  ) as MissRow[];
  return rows.map((r) => `${r.invited_by}|${r.miss_key}|${r.reason}`).sort();
}

/** Сутки команды — как у пропусков уровня человека (_shared/calendar-missed.ts). */
function teamDay(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `autojoin:${part("year")}-${part("month")}-${part("day")}`;
}

async function sweepMisses(): Promise<void> {
  const day = teamDay();
  const expected = [
    `${PEOPLE.a}|${keyOf(ZOOM)}|unsupported_platform`,
    `${PEOPLE.c}|${day}|calendar_not_connected`,
    `${PEOPLE.d}|${day}|calendar_token_dead`,
  ].sort();
  const afterPasses = await missesInDb();
  expect(
    "пропуски прохода записаны один раз, тихие причины — нет",
    JSON.stringify(afterPasses) === JSON.stringify(expected),
    { got: afterPasses, want: expected },
  );

  // Бот не дошёл. TOLD — задание B, бот заявил встречу и сам сказал человеку (нотиса двери).
  calendars.set(PEOPLE.b, [SHARED, RACE, TOLD]);
  const told = await call(PORT_CALENDAR, { headers: agentAuth });
  expect(
    "задание TOLD забрано",
    (told.body.jobs as Job[] ?? []).some((j) => j.calendar_key === keyOf(TOLD)),
    told,
  );
  const toldClaim = await claimAs(PEOPLE.b, keyOf(TOLD));
  await rest("POST", "meeting_notices", [{
    meeting_id: toldClaim.body.meeting_id,
    recipient_id: PEOPLE.b,
    kind: "door_denied",
    attempt: 1,
    status: "sent",
  }]);
  // SHARED: бот (claim за A выше) подал heartbeat — дошёл. RACE: заявки нет вовсе — не дошёл.
  await rest(
    "PATCH",
    `meetings?group_id=eq.${WS}&identity_key=eq.${
      encodeURIComponent(keyOf(SHARED))
    }`,
    {
      agent_last_seen_at: new Date().toISOString(),
    },
  );
  await rest("PATCH", `meeting_calendar_jobs?group_id=eq.${WS}`, {
    taken_at: iso(-7),
  });
  const check = await call(PORT_CALENDAR, { headers: agentAuth });
  expect(
    "проход с проверкой «дошёл ли бот» — 200",
    check.status === 200,
    check,
  );
  const withArrival = await missesInDb();
  const lost = withArrival.filter((m) => m.endsWith("|not_arrived"));
  expect(
    "не дошёл только RACE (за B); дошедший SHARED и сказавший TOLD — не пропуск",
    JSON.stringify(lost) ===
      JSON.stringify([`${PEOPLE.b}|${keyOf(RACE)}|not_arrived`]),
    lost,
  );
  const jobs = await rest(
    "GET",
    `meeting_calendar_jobs?group_id=eq.${WS}&select=calendar_key,arrival_checked_at`,
  ) as Json[];
  expect(
    "у всех забранных заданий итог проверки записан",
    jobs.length === 3 && jobs.every((j) => j.arrival_checked_at !== null),
    jobs,
  );
  await call(PORT_CALENDAR, { headers: agentAuth });
  expect(
    "повторный проход не множит пропуски",
    JSON.stringify(await missesInDb()) === JSON.stringify(withArrival),
  );
}

async function missed(
  token: string | null,
  init: RequestInit = {},
): Promise<{ status: number; body: Json }> {
  const hitsAtStart = google.hits;
  const res = await fetch(`http://127.0.0.1:${PORT_MISSED}/`, {
    method: "GET",
    ...init,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
  });
  const body = await res.json().catch(() => ({})) as Json;
  recorderGoogleHits += google.hits - hitsAtStart;
  return { status: res.status, body };
}

async function snapshot(
  secret: string | null,
  init: RequestInit = { method: "POST", body: JSON.stringify({ force: true }) },
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${PORT_SNAPSHOT}/`, {
    ...init,
    headers: secret === null ? {} : { "X-Cron-Secret": secret },
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})) as Json,
  };
}

type RunRow = { snapshot_at: string | null; outcome: string };
async function runOf(person: number): Promise<RunRow | undefined> {
  const rows = await rest(
    "GET",
    `meeting_calendar_snapshot_runs?invited_by=eq.${person}&select=snapshot_at,outcome`,
  ) as RunRow[];
  return rows[0];
}

type MissView = {
  id: string;
  reason: string;
  title: string | null;
  join_url: string | null;
  can_invite: boolean;
  message: { en: string; ru: string };
};

async function recorderMisses(): Promise<void> {
  // Встреча, которую служба не подхватила бы вовсе, и встреча, где бот забрал задание и пропал.
  await rest("POST", "meeting_calendar_jobs", [{
    group_id: WS,
    calendar_key: keyOf(LOSTBOT),
    invited_by: PEOPLE.g,
    join_url: LOSTBOT.hangoutLink,
    platform: "meet",
    title: LOSTBOT.summary,
    starts_at: LOSTBOT.start.dateTime,
    ends_at: LOSTBOT.end.dateTime,
    taken_at: iso(-8),
    taken_by: AGENT.id,
    arrival_checked_at: iso(-1),
  }]);

  expect("рекордер без токена — 401", (await missed(null)).status === 401);
  expect(
    "MCP-токен — 403, нужен токен рекордера",
    (await missed(mcpToken(PEOPLE.g))).status === 403,
  );
  expect(
    "токен служебного агента — 401",
    (await missed(AGENT.token)).status === 401,
  );
  const off = await missed(recorderToken(PEOPLE.h));
  expect(
    "автозапуск выключен — пропусков нет",
    off.status === 200 && off.body.autojoin === false &&
      (off.body.misses as unknown[]).length === 0,
    off,
  );

  const hitsBefore = google.hits;
  const before = await missed(recorderToken(PEOPLE.g));
  expect(
    "до первого снимка: checked=false, пропусков по встречам нет, Google не тронут",
    before.status === 200 && before.body.checked === false &&
      before.body.snapshot_at === null &&
      (before.body.misses as unknown[]).length === 0 &&
      google.hits === hitsBefore,
    before,
  );

  expect("снимок без секрета — 403", (await snapshot(null)).status === 403);
  expect(
    "снимок с чужим секретом — 403",
    (await snapshot(`${CRON_SECRET}x`)).status === 403,
  );
  expect(
    "снимок не POST — 405",
    (await snapshot(CRON_SECRET, { method: "GET" })).status === 405,
  );
  const snap = await snapshot(CRON_SECRET);
  const report = snap.body.report as Json | undefined;
  expect(
    "снимок: 6 человек с автозапуском — 4 прочитаны, C без календаря, D с мёртвым токеном",
    snap.status === 200 && snap.body.due === true && report?.people === 6 &&
      report.ok === 4 && report.calendar_not_connected === 1 &&
      report.calendar_token_dead === 1 && report.failed === 0,
    snap,
  );
  const runG = await runOf(PEOPLE.g);

  const first = await missed(recorderToken(PEOPLE.g));
  const list = (first.body.misses ?? []) as MissView[];
  const byReason = new Map(list.map((m) => [m.reason, m]));
  expect(
    "рекордер G — 200, снимок за сегодня есть",
    first.status === 200 && first.body.checked === true &&
      typeof first.body.snapshot_at === "string" &&
      Date.parse(first.body.snapshot_at) ===
        Date.parse(runG?.snapshot_at ?? ""),
    first,
  );
  expect(
    "G видит: служба не подхватила ORPHAN, бот не дошёл до LOSTBOT, ZOOM_NOW не в Meet",
    JSON.stringify(list.map((m) => `${m.title}|${m.reason}`).sort()) ===
      JSON.stringify(
        [
          `${ORPHAN.summary}|not_picked_up`,
          `${LOSTBOT.summary}|not_arrived`,
          `${ZOOM_NOW.summary}|unsupported_platform`,
        ].sort(),
      ),
    list,
  );
  const orphan = byReason.get("not_picked_up");
  expect(
    "по неподхваченной встрече можно позвать руками, по Zoom — нет; тексты EN+RU",
    orphan?.can_invite === true && orphan.join_url === ORPHAN_ROOM &&
      byReason.get("unsupported_platform")?.can_invite === false &&
      list.every((m) => m.message.en.length > 0 && m.message.ru.length > 0),
    list,
  );
  const again = await missed(recorderToken(PEOPLE.g));
  expect(
    "повторный опрос — те же пропуски, строк в базе не прибавилось",
    JSON.stringify(
          ((again.body.misses ?? []) as MissView[]).map((m) => m.id).sort(),
        ) ===
        JSON.stringify(list.map((m) => m.id).sort()) &&
      (await missesInDb()).filter((m) => m.startsWith(`${PEOPLE.g}|`))
          .length === 3,
    again.body,
  );

  const aZoom = await rest(
    "GET",
    `meeting_calendar_misses?group_id=eq.${WS}&invited_by=eq.${PEOPLE.a}&select=id`,
  ) as { id: string }[];
  const foreign = await missed(recorderToken(PEOPLE.g), {
    method: "POST",
    body: JSON.stringify({ miss_id: aZoom[0]?.id }),
  });
  expect("чужой пропуск — 404", foreign.status === 404, foreign);
  const zoomInvite = await missed(recorderToken(PEOPLE.g), {
    method: "POST",
    body: JSON.stringify({ miss_id: byReason.get("unsupported_platform")?.id }),
  });
  expect(
    "позвать на Zoom — 409 cannot_invite",
    zoomInvite.status === 409,
    zoomInvite,
  );

  const invite = await missed(recorderToken(PEOPLE.g), {
    method: "POST",
    body: JSON.stringify({ miss_id: orphan?.id }),
  });
  const inv = invite.body.invite as Json | undefined;
  expect(
    "позвать бота по пропуску — 201, приглашение на ту же комнату",
    invite.status === 201 && inv?.join_url === ORPHAN_ROOM &&
      inv.status === "pending",
    invite,
  );
  const rows = await rest(
    "GET",
    `meeting_invites?group_id=eq.${WS}&invited_by=eq.${PEOPLE.g}&select=id`,
  ) as { id: string }[];
  const missRow = await rest(
    "GET",
    `meeting_calendar_misses?id=eq.${orphan?.id}&select=invite_id`,
  ) as MissRow[];
  expect(
    "приглашение одно, пропуск закрыт им",
    rows.length === 1 && missRow[0]?.invite_id === rows[0].id,
    { rows, missRow },
  );
  const twice = await missed(recorderToken(PEOPLE.g), {
    method: "POST",
    body: JSON.stringify({ miss_id: orphan?.id }),
  });
  expect(
    "второе нажатие — то же приглашение, не второе",
    twice.status === 200 &&
      (twice.body.invite as Json | undefined)?.id === rows[0].id,
    twice,
  );
  const after = await missed(recorderToken(PEOPLE.g));
  expect(
    "позванная встреча из списка ушла",
    !((after.body.misses ?? []) as MissView[]).some((m) => m.id === orphan?.id),
    after.body,
  );

  // Бот всё-таки пришёл на LOSTBOT (heartbeat) — пропуск больше не показывается.
  await claimAs(PEOPLE.g, keyOf(LOSTBOT));
  await rest(
    "PATCH",
    `meetings?group_id=eq.${WS}&identity_key=eq.${
      encodeURIComponent(keyOf(LOSTBOT))
    }`,
    {
      agent_last_seen_at: new Date().toISOString(),
    },
  );
  const arrived = await missed(recorderToken(PEOPLE.g));
  expect(
    "бот появился в звонке — «не дошёл» больше не показывается",
    !((arrived.body.misses ?? []) as MissView[]).some((m) =>
      m.reason === "not_arrived"
    ),
    arrived.body,
  );

  const noCal = await missed(recorderToken(PEOPLE.c));
  expect(
    "C без календаря видит пропуск уровня человека на сегодня",
    noCal.status === 200 && noCal.body.checked === true &&
      ((noCal.body.misses ?? []) as MissView[]).map((m) => m.reason).join() ===
        "calendar_not_connected",
    noCal.body,
  );
  await snapshotBetweenRuns();
  expect(
    "ни один запрос рекордера не ходил в Google",
    recorderGoogleHits === 0,
    { recorderGoogleHits },
  );
}

/** Встреча после снимка, отменённая встреча и Google, моргнувший на снимке. */
async function snapshotBetweenRuns(): Promise<void> {
  const late = ev(`late-${RUN}`, {
    hangoutLink: "https://meet.google.com/smk-late-abc",
    start: { dateTime: iso(-5) },
    end: { dateTime: iso(40) },
  });
  calendars.set(PEOPLE.g, [ORPHAN, LOSTBOT, late]); // ZOOM_NOW отменили, LATE поставили
  const lateSeen = async () =>
    ((await missed(recorderToken(PEOPLE.g))).body.misses as MissView[] ?? [])
      .some((m) => m.title === late.summary);
  expect(
    "встреча, поставленная после снимка, до следующего не видна",
    !(await lateSeen()),
  );

  const again = await snapshot(CRON_SECRET);
  expect("второй снимок — 200", again.status === 200, again);
  expect("после снимка LATE видна: служба её не подхватила", await lateSeen());
  const runG = await runOf(PEOPLE.g);
  const current = await rest(
    "GET",
    `meeting_calendar_snapshot_events?invited_by=eq.${PEOPLE.g}&snapshot_at=eq.${
      encodeURIComponent(runG?.snapshot_at ?? "")
    }&select=calendar_key`,
  ) as { calendar_key: string }[];
  expect(
    "отменённая встреча в текущий снимок не входит (строка осталась со старым временем)",
    !current.some((r) => r.calendar_key === keyOf(ZOOM_NOW)) &&
      current.some((r) => r.calendar_key === keyOf(late)),
    current,
  );

  // Строка прежнего снимка (встречу отменили до второго снимка) — рекордер её не видит.
  const stale = `stale-${RUN}`;
  await rest("POST", "meeting_calendar_snapshot_events", [{
    group_id: WS,
    invited_by: PEOPLE.g,
    calendar_key: `${stale}:${iso(0).slice(0, 10)}`,
    snapshot_at: iso(-600),
    outcome: "expected",
    title: stale,
    join_url: "https://meet.google.com/smk-stal-abc",
    platform: "meet",
    starts_at: iso(-10),
    ends_at: iso(40),
  }]);
  const afterStale = await missed(recorderToken(PEOPLE.g));
  expect(
    "встреча из прежнего снимка не читается как текущая",
    afterStale.status === 200 &&
      !((afterStale.body.misses ?? []) as MissView[]).some((m) =>
        m.title === stale
      ),
    afterStale.body,
  );

  google.downFor = PEOPLE.g;
  const down = await snapshot(CRON_SECRET);
  google.downFor = null;
  const runDown = await runOf(PEOPLE.g);
  expect(
    "Google моргнул на снимке G — итог calendar_unavailable, snapshot_at прежний",
    (down.body.report as Json | undefined)?.calendar_unavailable === 1 &&
      runDown?.outcome === "calendar_unavailable" &&
      runDown.snapshot_at === runG?.snapshot_at,
    { down, runDown, runG },
  );
  const stillThere = await missed(recorderToken(PEOPLE.g));
  expect(
    "после моргнувшего снимка рекордер видит прежний снимок, checked=true",
    stillThere.body.checked === true &&
      ((stillThere.body.misses ?? []) as MissView[]).some((m) =>
        m.title === late.summary
      ),
    stillThere.body,
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
    spawnFunction("../supabase/functions/meeting-missed/index.ts", PORT_MISSED),
    spawnFunction(
      "../supabase/functions/meeting-calendar-snapshot/index.ts",
      PORT_SNAPSHOT,
    ),
  ];
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_CALENDAR, 30_000)) &&
      (await waitPort(PORT_CLAIM, 30_000)) &&
      (await waitPort(PORT_MISSED, 30_000)) &&
      (await waitPort(PORT_SNAPSHOT, 30_000));
    if (ready) {
      await scenario();
      await sweepMisses();
      await recorderMisses();
    }
  } finally {
    for (const f of fns) f.kill("SIGTERM");
    for (const f of fns) await f.status;
    await fake.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_CALENDAR}/${PORT_CLAIM}/${PORT_MISSED}/${PORT_SNAPSHOT} за 30 с.`,
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
