#!/usr/bin/env -S deno run --allow-all
// Смоук сторожа оборванной записи: настоящий heartbeat бота через настоящую функцию
// meeting-heartbeat → настоящий cron swarm-bot {meetings_watchdog:true} → что увидел бы человек
// в Telegram. Проверяется то, чего не видят юнит-тесты: запросы к живым таблицам
// (service_agents, allowed_users, meetings, meeting_notices) и условный сброс флага.
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
// Порты — от SMOKE_PORT_BASE (по умолчанию 4380, диапазон блока orchestrator/сторож; base..base+3
// — сам контур): base+4 — функция meeting-heartbeat, base+8 — функция swarm-bot, base+9 —
// поддельный Telegram. swarm-bot ходит в
// api.telegram.org напрямую, поэтому fetch подменяется предзагрузкой (--preload) только для
// этого хоста: настоящим людям ничего не уходит.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-watchdog-smoke.ts
// Красный, если хоть одно ожидание не сошлось или окружения нет.

const PORT_BASE = Number(Deno.env.get("SMOKE_PORT_BASE") ?? "4380");
const PORT_HB = PORT_BASE + 4;
const PORT_BOT = PORT_BASE + 8;
const PORT_TG = PORT_BASE + 9;
const CRON_SECRET = "smoke-cron-secret";

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

const RUN = Math.floor(Math.random() * 1e6);
const WS = `smoke-wd-${RUN}`;
const OWNER = 920_000_000_000 + RUN * 10; // за него бот пишет встречу, которая оборвалась
const OWNER_NOTIFIED = OWNER + 1; // ему оркестратор уже прислал container_died
const OWNER_ALIVE = OWNER + 2; // его встречу бот пишет прямо сейчас
const HUMAN_CRASH = OWNER + 3; // bumblebee замолчал посреди записи
const HUMAN_ALIVE = OWNER + 4; // bumblebee пишет, heartbeat свежий
const PEOPLE = [OWNER, OWNER_NOTIFIED, OWNER_ALIVE, HUMAN_CRASH, HUMAN_ALIVE];

const AGENT = {
  dead: { id: `scriba-wd-dead-${RUN}`, token: `wd-dead-${RUN}`, owner: OWNER },
  notified: {
    id: `scriba-wd-notified-${RUN}`,
    token: `wd-notified-${RUN}`,
    owner: OWNER_NOTIFIED,
  },
  alive: {
    id: `scriba-wd-alive-${RUN}`,
    token: `wd-alive-${RUN}`,
    owner: OWNER_ALIVE,
  },
};
const MEETING = {
  dead: { id: crypto.randomUUID(), title: "Weekly <sync>", owner: OWNER },
  notified: { id: crypto.randomUUID(), title: "Ретро", owner: OWNER_NOTIFIED },
  alive: { id: crypto.randomUUID(), title: "Daily", owner: OWNER_ALIVE },
};
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
const ALL_MEETING_IDS = [...Object.values(MEETING), ...Object.values(GHOST)]
  .map((m) => m.id);

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

// ── Поддельный Telegram ─────────────────────────────────────────────────────────

const inbox: Array<{ chat_id: number; text: string }> = [];
function startTelegram(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: PORT_TG,
    onListen: () => {},
  }, async (req) => {
    const body = await req.json().catch(() => ({}));
    if (new URL(req.url).pathname.endsWith("/sendMessage")) {
      inbox.push({
        chat_id: Number(body.chat_id),
        text: String(body.text ?? ""),
      });
    }
    return Response.json({ ok: true, result: { message_id: inbox.length } });
  });
}

// Предзагрузка для swarm-bot: api.telegram.org → поддельный Telegram. Больше ничего не трогает.
const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.telegram.org/")) {
    return real(url.replace("https://api.telegram.org", "http://127.0.0.1:${PORT_TG}"), init);
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
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke watchdog" }]);
  await rest(
    "POST",
    "allowed_users",
    PEOPLE.map((id) => ({ telegram_id: id, group_id: WS, added_by: id })),
  );
  await rest(
    "POST",
    "service_agents",
    await Promise.all(
      Object.values(AGENT).map(async (a) => ({
        id: a.id,
        name: "scriba",
        group_id: WS,
        token_hash: await sha256Hex(a.token),
      })),
    ),
  );
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
  const steps: Array<[string, string]> = [
    [
      "DELETE",
      `meetings?id=in.(${ALL_MEETING_IDS.join(",")})`,
    ], // notices — каскадом
    [
      "DELETE",
      `service_agents?id=in.(${
        Object.values(AGENT).map((a) => a.id).join(",")
      })`,
    ],
    ["DELETE", `allowed_users?telegram_id=in.(${PEOPLE.join(",")})`],
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

// ── Сценарий ────────────────────────────────────────────────────────────────────

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function expect(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

async function beat(
  agent: { id: string; token: string; owner: number },
  meetingKey: string,
): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${PORT_HB}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agent.token}`,
      "X-On-Behalf-Of": String(agent.owner),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recording: true,
      version: 1,
      on_call: true,
      meeting_key: meetingKey,
    }),
  });
  await res.body?.cancel();
  return res.status;
}

async function agentRow(id: string) {
  const rows = await rest(
    "GET",
    `service_agents?id=eq.${id}&select=last_seen_at,last_recording,last_meeting_key`,
  );
  return (rows as Array<
    {
      last_seen_at: string | null;
      last_recording: boolean | null;
      last_meeting_key: string | null;
    }
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
  // 1. Настоящий heartbeat бота через meeting-heartbeat: ложится в service_agents, не в человека.
  for (const k of ["dead", "notified", "alive"] as const) {
    const status = await beat(AGENT[k], keyOf(MEETING[k]));
    expect(`heartbeat ${k} принят`, status === 200, `HTTP ${status}`);
  }
  const deadRow = await agentRow(AGENT.dead.id);
  expect(
    "heartbeat бота в service_agents: recording=true и ключ встречи",
    deadRow?.last_recording === true &&
      deadRow?.last_meeting_key === keyOf(MEETING.dead),
    JSON.stringify(deadRow),
  );
  expect(
    "heartbeat бота НЕ тронул строку человека",
    (await humanRecording(OWNER)) === null,
  );

  // 2. Состарить: dead и notified замолчали 15 мин назад, alive свежий; люди — как в жизни.
  await rest(
    "PATCH",
    `service_agents?id=in.(${AGENT.dead.id},${AGENT.notified.id})`,
    { last_seen_at: minutesAgo(15) },
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
  expect("живой бот → тишина", to(OWNER_ALIVE).length === 0);
  expect(
    "bumblebee замолчал → алерт ему самому, текст про bumblebee (как раньше)",
    to(HUMAN_CRASH).length === 1 &&
      to(HUMAN_CRASH)[0].text.includes("bumblebee"),
    JSON.stringify(to(HUMAN_CRASH)),
  );
  expect("живой bumblebee → тишина", to(HUMAN_ALIVE).length === 0);
  expect(
    "флаг мёртвого бота сброшен",
    (await agentRow(AGENT.dead.id))?.last_recording === false,
  );
  expect(
    "флаг бота с container_died сброшен",
    (await agentRow(AGENT.notified.id))?.last_recording === false,
  );
  expect(
    "флаг живого бота не тронут",
    (await agentRow(AGENT.alive.id))?.last_recording === true,
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
    "встреча, которую ещё пишет бот (свежий heartbeat по её ключу), не помечена failed",
    (await summaryStatus(MEETING.alive.id)) === null,
    String(await summaryStatus(MEETING.alive.id)),
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
  const bot = spawnFunction(
    "../supabase/functions/swarm-bot/index.ts",
    PORT_BOT,
    [`--preload=${PRELOAD}`],
  );
  let cleanupProblems: string[] = [];
  let ready = false;
  try {
    await seed();
    ready = (await waitPort(PORT_HB, 30_000)) &&
      (await waitPort(PORT_BOT, 30_000));
    if (ready) await scenario();
  } finally {
    hb.kill("SIGTERM");
    bot.kill("SIGTERM");
    await hb.status;
    await bot.status;
    await tg.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(
      `КРАСНЫЙ: функции не поднялись на ${PORT_HB}/${PORT_BOT} за 30 с — проверять нечего.`,
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
