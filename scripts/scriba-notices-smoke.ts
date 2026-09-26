#!/usr/bin/env -S deno run --allow-all
// Смоук блока notices: КАЖДЫЙ сценарий отказа из спеки проходится по-настоящему и обязан
// закончиться внятным сигналом человеку. Молчаливый сбой — главный класс дефектов этого
// продукта, и проверяется он запуском, а не чтением кода. Отдельно — потолок: зацикленный бот
// не должен превратить личку человека в ленту.
//
// Что нужно: ЛОКАЛЬНЫЙ контур Supabase (настоящие Postgres + PostgREST с накатанными
// миграциями — журнал meeting_notices и его уникальные индексы проверяются живой базой, а не
// подделкой). Прод сюда не подставлять: смоук заводит и удаляет строки.
//
//   SMOKE_SUPABASE_URL   — http://127.0.0.1:<порт API локального контура>
//   SMOKE_SERVICE_KEY    — SERVICE_ROLE_KEY из `supabase status -o env`
//
// Порты блока (4340-4349): 4340 — НАСТОЯЩАЯ функция meeting-notice/index.ts отдельным
// процессом; 4342 — поддельный Telegram (записывает, что человек увидел бы в чате, и умеет
// отказать). Живого Telegram здесь нет намеренно: сообщения настоящим людям не уходят.
//
// Запуск: SMOKE_SUPABASE_URL=… SMOKE_SERVICE_KEY=… deno run --allow-all scripts/scriba-notices-smoke.ts
// Красный, если хотя бы один сценарий закончился тишиной, если потолок пропустил лишнее
// сообщение или если окружения нет (непроверенное не выдаётся за проверенное).

const PORT_FN = 4340;
const PORT_TG = 4342;

const SUPABASE_URL = Deno.env.get("SMOKE_SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SMOKE_SERVICE_KEY") ?? "";

// Идентификаторы прогона: случайные, чтобы повторный прогон не упирался в прошлый.
const RUN = Math.floor(Math.random() * 1e6);
const BOT_TOKEN = `smoke-bot-token-${RUN}`;
const HUMAN_TOKEN = `smoke-human-token-${RUN}`;
const OWNER_ID = 910_000_000_000 + RUN; // владелец встречи, которому шлём
const BLOCKED_ID = OWNER_ID + 1; // владелец, у которого Telegram откажет (заблокировал бота)
const COLLEAGUE_ID = OWNER_ID + 2; // коллега из того же воркспейса — владелец чужой встречи
const OUTSIDER_ID = OWNER_ID + 3; // человек из чужого воркспейса
const WS = `smoke-alpha-${RUN}`;
const WS_OTHER = `smoke-beta-${RUN}`;
const AGENT_ID = `scriba-smoke-${RUN}`;

const M = {
  door: crypto.randomUUID(),
  entry: crypto.randomUUID(),
  late: crypto.randomUUID(),
  race: crypto.randomUUID(),
  en: crypto.randomUUID(),
  blocked: crypto.randomUUID(),
  colleagues: crypto.randomUUID(),
  foreign: crypto.randomUUID(),
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Живая база: засев и уборка через PostgREST под service_role ────────────────

async function rest(method: string, path: string, body?: unknown): Promise<unknown> {
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

function person(id: number, groupId: string, recorderHash: string | null) {
  return { telegram_id: id, group_id: groupId, added_by: id, recorder_token_hash: recorderHash };
}

function meeting(id: string, groupId: string, owner: number, title: string) {
  return {
    id,
    source: "scriba-smoke",
    identity_kind: "manual",
    identity_key: `manual:${id}`,
    group_id: groupId,
    claim_owner: owner,
    title,
  };
}

async function seed(): Promise<void> {
  await rest("POST", "workspaces", [{ id: WS, name: "Smoke A" }, { id: WS_OTHER, name: "Smoke B" }]);
  await rest("POST", "allowed_users", [
    person(OWNER_ID, WS, await sha256Hex(HUMAN_TOKEN)),
    person(BLOCKED_ID, WS, null),
    person(COLLEAGUE_ID, WS, null),
    person(OUTSIDER_ID, WS_OTHER, null),
  ]);
  await rest("POST", "service_agents", [{
    id: AGENT_ID,
    name: "scriba",
    group_id: WS,
    token_hash: await sha256Hex(BOT_TOKEN),
  }]);
  await rest("POST", "meetings", [
    meeting(M.door, WS, OWNER_ID, "Дневной синк"),
    meeting(M.entry, WS, OWNER_ID, "Планёрка"),
    meeting(M.late, WS, OWNER_ID, "Ретро"),
    meeting(M.race, WS, OWNER_ID, "Гонка"),
    meeting(M.en, WS, OWNER_ID, "Daily sync"),
    meeting(M.blocked, WS, BLOCKED_ID, "Встреча заблокировавшего"),
    meeting(M.colleagues, WS, COLLEAGUE_ID, "Разбор зарплат"),
    meeting(M.foreign, WS_OTHER, OUTSIDER_ID, "Чужой совет"),
  ]);
}

/** Уборка: встречи и люди прогона. Журнал уходит каскадом (удаления у service_role нет). */
async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  const steps: [string, string][] = [
    ["DELETE", `meetings?source=eq.scriba-smoke&group_id=in.(${WS},${WS_OTHER})`],
    ["DELETE", `service_agents?id=eq.${AGENT_ID}`],
    ["DELETE", `allowed_users?telegram_id=in.(${OWNER_ID},${BLOCKED_ID},${COLLEAGUE_ID},${OUTSIDER_ID})`],
    ["DELETE", `workspaces?id=in.(${WS},${WS_OTHER})`],
  ];
  for (const [method, path] of steps) {
    try {
      await rest(method, path);
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  return problems;
}

async function journal(filter: string): Promise<{ kind: string; attempt: number; status: string }[]> {
  return await rest("GET", `meeting_notices?select=kind,attempt,status&${filter}&order=id`) as {
    kind: string;
    attempt: number;
    status: string;
  }[];
}

// ── Поддельный Telegram ───────────────────────────────────────────────────────

interface TgMessage {
  chatId: number;
  text: string;
}

const inbox: TgMessage[] = [];

function startTelegram(): Deno.HttpServer {
  return Deno.serve({ port: PORT_TG, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const body = await req.json() as { chat_id: number; text: string };
    // Живой отказ Telegram: человек не начинал диалог с ботом или заблокировал его.
    if (body.chat_id === BLOCKED_ID) {
      return Response.json(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        { status: 403 },
      );
    }
    inbox.push({ chatId: body.chat_id, text: body.text });
    return Response.json({ ok: true, result: { message_id: inbox.length } });
  });
}

// ── Сценарии ──────────────────────────────────────────────────────────────────

interface Outcome {
  name: string;
  status: number;
  signal: string; // что увидел человек, либо чем ответила система
  problem: string | null; // чем сценарий не сошёлся: тишина, не тот исход, пробитый потолок
}

async function call(
  body: unknown,
  opts: { token?: string; onBehalfOf?: number | string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", `Bearer ${opts.token ?? BOT_TOKEN}`);
  if (opts.onBehalfOf !== undefined) headers.set("X-On-Behalf-Of", String(opts.onBehalfOf));
  const res = await fetch(`http://127.0.0.1:${PORT_FN}/meeting-notice`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await res.json() as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

/**
 * Прогон одного сценария. Проверяется два условия сразу:
 *   • сценарий не закончился тишиной (2xx без сообщения человеку либо отказ без причины);
 *   • исход тот, который заявлен: «дошло до человека» или «отклонено и НЕ дошло».
 */
async function scenario(
  name: string,
  body: unknown,
  opts: {
    token?: string;
    onBehalfOf?: number | string;
    lang?: "en" | "ru";
    expect?: "delivered" | "refused";
  } = {},
): Promise<Outcome> {
  const expect = opts.expect ?? "delivered";
  const before = inbox.length;
  const withLang = typeof body === "object" && body !== null ? { ...body, lang: opts.lang ?? "ru" } : body;
  const { status, body: answer } = await call(withLang, opts);
  const delivered = inbox.slice(before);
  const error = typeof answer.error === "string" ? answer.error : "";
  const leave = answer.should_leave === true ? " · боту сказано уйти" : "";

  if (delivered.length > 1) {
    return { name, status, signal: `ушло ${delivered.length} сообщений`, problem: "один вызов — одно сообщение" };
  }
  if (delivered.length === 1) {
    const signal = `→ ${delivered[0].chatId}: ${delivered[0].text}${leave}`;
    const problem = expect === "refused" ? "сообщение ушло человеку, хотя сценарий должен был быть отклонён" : null;
    return { name, status, signal, problem };
  }
  if (status >= 200 && status < 300) {
    // 2xx без сообщения человеку — ровно тот молчаливый успех, который ищем.
    return { name, status, signal: "НИЧЕГО НЕ ОТПРАВЛЕНО, но ответ 2xx", problem: "тишина: успех без сигнала" };
  }
  if (error.trim() === "") {
    return { name, status, signal: "отказ без объяснения", problem: "тишина: отказ без причины" };
  }
  const problem = expect === "delivered" ? "сообщение не дошло до человека, хотя сценарий этого требует" : null;
  return { name, status, signal: `отказ: ${error}${leave}`, problem };
}

function check(name: string, ok: boolean, signal: string, problem: string): Outcome {
  return { name, status: 0, signal, problem: ok ? null : problem };
}

/** Дверь: первое, единственный повтор, дальше — зацикленный бот, которому сервер не верит. */
async function doorScenarios(behalf: { onBehalfOf: number }): Promise<Outcome[]> {
  const door = { kind: "door_waiting", meeting_id: M.door };
  const out: Outcome[] = [
    await scenario("дверь · не впустили (90 с)", door, behalf),
    await scenario("дверь · единственный повтор (+3 мин)", door, behalf),
    await scenario("дверь · третьего уведомления не бывает", door, { ...behalf, expect: "refused" }),
  ];
  const before = inbox.length;
  for (let i = 0; i < 7; i++) await call({ ...door, lang: "ru" }, behalf);
  const rows = await journal(`meeting_id=eq.${M.door}`);
  out.push(check(
    "дверь · зацикленный бот, ещё 7 вызовов",
    inbox.length === before && rows.length === 2,
    `новых сообщений: ${inbox.length - before}; в журнале по встрече: ${rows.length}`,
    "потолок пробит: зацикленный бот дошёл до человека",
  ));
  out.push(
    await scenario("номер попытки из тела запроса — не принимается", { ...door, attempt: 1 }, {
      ...behalf,
      expect: "refused",
    }),
  );
  return out;
}

/** Гонка одновременных вызовов: уникальный индекс живой базы пропускает одно сообщение. */
async function raceScenario(behalf: { onBehalfOf: number }): Promise<Outcome> {
  const before = inbox.length;
  // Пять, а не два: гонка зависит от расписания, и на двух вызовах сломанный индекс ловился не
  // каждым прогоном (проверено порчей: 2 из 3). Пять одновременных делают промах маловероятным.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call({ kind: "no_audio", meeting_id: M.race, lang: "ru" }, behalf)),
  );
  const statuses = results.map((r) => r.status).sort().join(",");
  return check(
    "гонка · пять одновременных «звука нет»",
    inbox.length - before === 1 && statuses === "200,409,409,409,409",
    `сообщений: ${inbox.length - before}; ответы: ${statuses}`,
    "одновременные вызовы дали не одно сообщение",
  );
}

async function meetingScenarios(behalf: { onBehalfOf: number }): Promise<Outcome[]> {
  return [
    await scenario("вход отклонён хостом", { kind: "door_denied", meeting_id: M.entry }, behalf),
    await scenario("капча на входе", { kind: "captcha", meeting_id: M.entry }, behalf),
    await scenario("звука нет, запись не начата", { kind: "no_audio", meeting_id: M.entry }, behalf),
    await scenario("«звука нет» второй раз — уже сказано", { kind: "no_audio", meeting_id: M.entry }, {
      ...behalf,
      expect: "refused",
    }),
    await scenario("сеть отвалилась, запись не доехала", {
      kind: "recording_lost",
      meeting_id: M.entry,
      detail: "ingest: connection reset by peer",
    }, behalf),
    await scenario("контейнер умер посреди встречи", {
      kind: "container_died",
      meeting_id: M.late,
      detail: "exit code 137 (OOM)",
    }, behalf),
    await scenario("иная причина захода", {
      kind: "join_failed",
      meeting_id: M.late,
      detail: "meet: selector timeout",
    }, behalf),
    await scenario("иная причина без объяснения — не принимается", { kind: "join_failed", meeting_id: M.late }, {
      ...behalf,
      expect: "refused",
    }),
    await scenario("название из контейнера — не принимается", {
      kind: "captcha",
      meeting_id: M.late,
      title: "Подмена",
    }, { ...behalf, expect: "refused" }),
  ];
}

async function preMeetingScenarios(behalf: { onBehalfOf: number }): Promise<Outcome[]> {
  const key = `smoke-${RUN}@google.com:2026-09-26`;
  return [
    await scenario("ссылка на звонок не распозналась", {
      kind: "no_conference_link",
      meeting_key: key,
      title: "Дневной синк",
    }, behalf),
    await scenario("владелец встречи не определился", { kind: "no_owner", meeting_key: key }, behalf),
    await scenario("до-встречный отказ с meeting_id — не принимается", {
      kind: "no_owner",
      meeting_id: M.entry,
    }, { ...behalf, expect: "refused" }),
  ];
}

async function accessScenarios(behalf: { onBehalfOf: number }): Promise<Outcome[]> {
  const out = [
    await scenario("встреча чужого воркспейса", { kind: "no_audio", meeting_id: M.foreign }, {
      ...behalf,
      expect: "refused",
    }),
    await scenario("встреча коллеги — не владелец", { kind: "door_denied", meeting_id: M.colleagues }, {
      ...behalf,
      expect: "refused",
    }),
    await scenario("встречи нет", { kind: "no_audio", meeting_id: crypto.randomUUID() }, {
      ...behalf,
      expect: "refused",
    }),
    await scenario("человек из чужого воркспейса — вход запрещён", { kind: "no_audio", meeting_id: M.foreign }, {
      onBehalfOf: OUTSIDER_ID,
      expect: "refused",
    }),
    await scenario("получатель в теле запроса игнорируется", {
      kind: "container_died",
      meeting_id: M.race,
      chat_id: COLLEAGUE_ID,
      telegram_id: COLLEAGUE_ID,
    }, behalf),
    await scenario("токен бота умер", { kind: "no_audio", meeting_id: M.entry }, {
      token: "dead-token",
      ...behalf,
      expect: "refused",
    }),
    await scenario("токен бота без указания человека", { kind: "no_audio", meeting_id: M.entry }, {
      expect: "refused",
    }),
    await scenario("личный токен человека", { kind: "door_denied", meeting_id: M.late }, { token: HUMAN_TOKEN }),
    await scenario("мусор в теле запроса", "{это не json", { ...behalf, expect: "refused" }),
    await scenario("неизвестный вид отказа", { kind: "vsyo_horosho", meeting_id: M.entry }, {
      ...behalf,
      expect: "refused",
    }),
  ];
  const leaked = inbox.some((m) => m.chatId !== OWNER_ID);
  out.push(check(
    "никому, кроме владельца",
    !leaked,
    `адресаты: ${[...new Set(inbox.map((m) => m.chatId))].join(", ")}`,
    "сообщение ушло не владельцу встречи",
  ));
  return out;
}

async function blockedScenarios(): Promise<Outcome[]> {
  const out = [
    await scenario("Telegram не принял уведомление", { kind: "no_audio", meeting_id: M.blocked }, {
      onBehalfOf: BLOCKED_ID,
      expect: "refused",
    }),
  ];
  const rows = await journal(`meeting_id=eq.${M.blocked}`);
  out.push(check(
    "недоставленное не занимает номер",
    rows.length === 1 && rows[0].status === "failed",
    `журнал: ${JSON.stringify(rows)}`,
    "недоставленное уведомление записано как отправленное — повтор после сбоя невозможен",
  ));
  return out;
}

async function runScenarios(): Promise<Outcome[]> {
  const behalf = { onBehalfOf: OWNER_ID };
  return [
    ...await doorScenarios(behalf),
    await raceScenario(behalf),
    ...await meetingScenarios(behalf),
    ...await preMeetingScenarios(behalf),
    ...await accessScenarios(behalf),
    ...await blockedScenarios(),
    // Два языка — правило проекта. Всё выше прошло по-русски; здесь по-английски.
    await scenario("EN · дверь, первое уведомление", { kind: "door_waiting", meeting_id: M.en }, {
      ...behalf,
      lang: "en",
    }),
    await scenario("EN · звука нет", { kind: "no_audio", meeting_id: M.en }, { ...behalf, lang: "en" }),
  ];
}

// ── Запуск стенда ─────────────────────────────────────────────────────────────

async function waitReady(deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT_FN}/meeting-notice`, { method: "GET" });
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

function report(outcomes: Outcome[], cleanupProblems: string[]): void {
  console.log(`\n════ сценарии отказа (${outcomes.length})\n`);
  for (const o of outcomes) {
    const code = o.status === 0 ? "" : ` [HTTP ${o.status}]`;
    console.log(`${o.problem === null ? "✔" : "✘"} ${o.name}${code}\n   ${o.signal}`);
    if (o.problem !== null) console.log(`   ✘ ${o.problem}`);
    console.log("");
  }
  const broken = outcomes.filter((o) => o.problem !== null);
  if (cleanupProblems.length > 0) {
    console.error(`КРАСНЫЙ: уборка не прошла — строки прогона остались в базе:`);
    for (const p of cleanupProblems) console.error(`  ✘ ${p}`);
  }
  if (broken.length > 0) {
    console.error(`КРАСНЫЙ: не сошлись ${broken.length} сценариев:`);
    for (const o of broken) console.error(`  ✘ ${o.name}: ${o.problem}`);
  }
  if (broken.length > 0 || cleanupProblems.length > 0) Deno.exit(1);
  console.log(`ЗЕЛЁНЫЙ: ${outcomes.length} сценариев, каждый закончился сигналом человеку либо внятным отказом.`);
}

async function main(): Promise<void> {
  if (SUPABASE_URL === "" || SERVICE_KEY === "") {
    console.error("КРАСНЫЙ: нет SMOKE_SUPABASE_URL / SMOKE_SERVICE_KEY — смоук не выполнялся (см. шапку).");
    Deno.exit(1);
  }
  const tg = startTelegram();
  const fnPath = new URL("../supabase/functions/meeting-notice/index.ts", import.meta.url).pathname;
  const child = new Deno.Command("deno", {
    args: ["run", "--allow-all", fnPath],
    env: {
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORT_FN}`,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      TELEGRAM_BOT_TOKEN: "smoke-telegram-token",
      TELEGRAM_API_BASE: `http://127.0.0.1:${PORT_TG}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  let outcomes: Outcome[] = [];
  let ready = false;
  let cleanupProblems: string[] = [];
  try {
    await seed();
    ready = await waitReady(20_000);
    if (ready) outcomes = await runScenarios();
  } finally {
    child.kill("SIGTERM");
    await child.status;
    await tg.shutdown();
    cleanupProblems = await cleanup();
  }
  if (!ready) {
    console.error(`КРАСНЫЙ: функция не поднялась на порту ${PORT_FN} за 20 с — проверять нечего.`);
    Deno.exit(1);
  }
  report(outcomes, cleanupProblems);
}

await main();
