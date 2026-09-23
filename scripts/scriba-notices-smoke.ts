#!/usr/bin/env -S deno run --allow-all
// Смоук блока notices: КАЖДЫЙ сценарий отказа из спеки проходится по-настоящему и обязан
// закончиться внятным сигналом человеку. Молчаливый сбой — главный класс дефектов этого
// продукта, и проверяется он запуском, а не чтением кода.
//
// Что поднимается (порты блока, 4340-4349):
//   4340 — НАСТОЯЩАЯ функция supabase/functions/meeting-notice/index.ts, отдельным процессом;
//   4341 — поддельный PostgREST (строки allowed_users / service_agents под токены стенда);
//   4342 — поддельный Telegram: записывает, что человек увидел бы в чате, и умеет отказать.
//
// Живого Telegram и живой базы здесь нет намеренно: смоук гоняется в любой копии и не шлёт
// сообщений настоящим людям. Проверяется путь целиком — HTTP, дверь авторизации, рендер
// текста, отправка и ответ вызывающему.
//
// Запуск: deno run --allow-all scripts/scriba-notices-smoke.ts
// Красный, если хотя бы один сценарий закончился тишиной (2xx без сообщения человеку либо
// отказ без объяснения).

const PORT_FN = 4340;
const PORT_DB = 4341;
const PORT_TG = 4342;

const BOT_TOKEN = "smoke-bot-token";
const HUMAN_TOKEN = "smoke-human-token";
const OWNER_ID = 900000001; // владелец встречи, которому шлём
const BLOCKED_ID = 900000002; // владелец, у которого Telegram откажет (заблокировал бота)
const OUTSIDER_ID = 900000009; // человек из чужого воркспейса

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Поддельный PostgREST ──────────────────────────────────────────────────────

function human(
  id: number,
  groupId: string | null,
  recorderHash: string | null,
) {
  return {
    telegram_id: id,
    group_id: groupId,
    claude_mcp_token_hash: null,
    claude_mcp_token_expires_at: null,
    recorder_token_hash: recorderHash,
    recorder_token_expires_at: null,
    recorder_token_prev_hash: null,
    recorder_token_prev_expires_at: null,
  };
}

async function startDb(): Promise<Deno.HttpServer> {
  const botHash = await sha256Hex(BOT_TOKEN);
  const humanHash = await sha256Hex(HUMAN_TOKEN);
  const people = [
    human(OWNER_ID, "alpha", humanHash),
    human(BLOCKED_ID, "alpha", null),
    human(OUTSIDER_ID, "beta", null),
  ];
  const agents = [{
    id: "scriba-smoke",
    name: "scriba",
    group_id: "alpha",
    token_hash: botHash,
    token_expires_at: null,
    is_active: true,
  }];

  return Deno.serve({
    port: PORT_DB,
    hostname: "127.0.0.1",
    onListen: () => {},
  }, (req) => {
    const url = new URL(req.url);
    const table = url.pathname.replace("/rest/v1/", "");
    const or = url.searchParams.get("or") ?? "";
    const tokenEq = url.searchParams.get("token_hash")?.replace("eq.", "") ??
      null;
    const idEq = url.searchParams.get("telegram_id")?.replace("eq.", "") ??
      null;

    let rows: Record<string, unknown>[] = [];
    if (table === "allowed_users" && or !== "") {
      rows = people.filter((p) =>
        p.recorder_token_hash !== null && or.includes(p.recorder_token_hash)
      );
    } else if (table === "allowed_users" && idEq !== null) {
      rows = people.filter((p) => String(p.telegram_id) === idEq)
        .map((p) => ({ telegram_id: p.telegram_id, group_id: p.group_id }));
    } else if (table === "service_agents" && tokenEq !== null) {
      rows = agents.filter((a) => a.token_hash === tokenEq);
    }

    // maybeSingle умеет просить одиночный объект — тогда пустой ответ это 406/PGRST116.
    if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object+json")) {
      if (rows.length === 1) return Response.json(rows[0]);
      return Response.json({ code: "PGRST116", message: "0 rows" }, {
        status: 406,
      });
    }
    return Response.json(rows);
  });
}

// ── Поддельный Telegram ───────────────────────────────────────────────────────

interface TgMessage {
  chatId: number;
  text: string;
}

const inbox: TgMessage[] = [];

function startTelegram(): Deno.HttpServer {
  return Deno.serve({
    port: PORT_TG,
    hostname: "127.0.0.1",
    onListen: () => {},
  }, async (req) => {
    const body = await req.json() as { chat_id: number; text: string };
    // Живой отказ Telegram: человек не начинал диалог с ботом или заблокировал его.
    if (body.chat_id === BLOCKED_ID) {
      return Response.json(
        {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        },
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
  problem: string | null; // чем сценарий не сошёлся: тишина или не тот исход
}

async function call(
  body: unknown,
  opts: { token?: string; onBehalfOf?: number | string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", `Bearer ${opts.token ?? BOT_TOKEN}`);
  if (opts.onBehalfOf !== undefined) {
    headers.set("X-On-Behalf-Of", String(opts.onBehalfOf));
  }
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
 * Второе нужно ровно для двери: третье уведомление обязано не уйти никуда.
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
  const withLang = typeof body === "object" && body !== null
    ? { ...body, lang: opts.lang ?? "ru" }
    : body;
  const { status, body: answer } = await call(withLang, opts);
  const delivered = inbox.slice(before);
  const error = typeof answer.error === "string" ? answer.error : "";
  const leave = answer.should_leave === true ? " · боту сказано уйти" : "";

  if (delivered.length > 0) {
    const signal = `→ ${delivered[0].chatId}: ${delivered[0].text}${leave}`;
    const problem = expect === "refused"
      ? "сообщение ушло человеку, хотя сценарий должен был быть отклонён"
      : null;
    return { name, status, signal, problem };
  }
  if (status >= 200 && status < 300) {
    // 2xx без сообщения человеку — ровно тот молчаливый успех, который ищем.
    return {
      name,
      status,
      signal: "НИЧЕГО НЕ ОТПРАВЛЕНО, но ответ 2xx",
      problem: "тишина: успех без сигнала человеку",
    };
  }
  if (error.trim() === "") {
    return {
      name,
      status,
      signal: "отказ без объяснения",
      problem: "тишина: отказ без причины",
    };
  }
  const problem = expect === "delivered"
    ? "сообщение не дошло до человека, хотя сценарий этого требует"
    : null;
  return { name, status, signal: `отказ: ${error}${leave}`, problem };
}

async function runScenarios(): Promise<Outcome[]> {
  const behalf = { onBehalfOf: OWNER_ID };
  const title = "Дневной синк";
  const out: Outcome[] = [];

  // 1. Бота не впустили: 90 с у двери, ровно один повтор, затем выход.
  out.push(
    await scenario("дверь · не впустили (90 с)", {
      kind: "door_waiting",
      attempt: 1,
      title,
    }, behalf),
  );
  out.push(
    await scenario("дверь · единственный повтор (+3 мин)", {
      kind: "door_waiting",
      attempt: 2,
      title,
    }, behalf),
  );
  out.push(
    await scenario("дверь · третьего уведомления не бывает", {
      kind: "door_waiting",
      attempt: 3,
      title,
    }, { ...behalf, expect: "refused" }),
  );
  // 2. Хост отклонил заявку.
  out.push(
    await scenario(
      "вход отклонён хостом",
      { kind: "door_denied", title },
      behalf,
    ),
  );
  // 3. Капча на входе.
  out.push(
    await scenario("капча на входе", { kind: "captcha", title }, behalf),
  );
  // 4. Звонок не начался: ссылки в приглашении нет.
  out.push(
    await scenario("ссылка на звонок не распозналась", {
      kind: "no_conference_link",
      title,
    }, behalf),
  );
  // 5. Владелец не определился — бот не заходит.
  out.push(
    await scenario("владелец встречи не определился", {
      kind: "no_owner",
      title,
    }, behalf),
  );
  out.push(
    await scenario("владелец из чужого воркспейса — вход запрещён", {
      kind: "no_owner",
      title,
    }, { onBehalfOf: OUTSIDER_ID, expect: "refused" }),
  );
  // 6. Звука нет — запись не начата.
  out.push(
    await scenario(
      "звука нет, запись не начата",
      { kind: "no_audio", title },
      behalf,
    ),
  );
  // 7. Сеть отвалилась: запись есть, но не доехала; и отдельно — не доехало само уведомление.
  out.push(
    await scenario("сеть отвалилась, запись не доехала", {
      kind: "recording_lost",
      title,
      detail: "ingest: connection reset by peer",
    }, behalf),
  );
  out.push(
    await scenario("Telegram не принял уведомление", {
      kind: "no_audio",
      title,
    }, { onBehalfOf: BLOCKED_ID, expect: "refused" }),
  );
  // 8. Токен умер.
  out.push(
    await scenario("токен бота умер", { kind: "no_audio", title }, {
      token: "dead-token",
      ...behalf,
      expect: "refused",
    }),
  );
  out.push(
    await scenario("токен бота без указания человека", {
      kind: "no_audio",
      title,
    }, { expect: "refused" }),
  );
  // 9. Контейнер умер посреди встречи.
  out.push(
    await scenario("контейнер умер посреди встречи", {
      kind: "container_died",
      title,
      detail: "exit code 137 (OOM)",
    }, behalf),
  );
  // 10. Прочее: причина обязательна, мусор отвергается внятно.
  out.push(
    await scenario("иная причина захода", {
      kind: "join_failed",
      title,
      detail: "meet: selector timeout",
    }, behalf),
  );
  out.push(
    await scenario("иная причина без объяснения — не принимается", {
      kind: "join_failed",
      title,
    }, { ...behalf, expect: "refused" }),
  );
  out.push(
    await scenario("мусор в теле запроса", "{это не json", {
      ...behalf,
      expect: "refused",
    }),
  );
  out.push(
    await scenario(
      "неизвестный вид отказа",
      { kind: "vsyo_horosho", title },
      { ...behalf, expect: "refused" },
    ),
  );
  // 11. Два языка — правило проекта. Весь список выше прошёл по-русски; здесь то же самое
  // по-английски, чтобы каталог обоих языков проверялся живым вызовом, а не только тестом.
  out.push(
    await scenario("EN · дверь, первое уведомление", {
      kind: "door_waiting",
      attempt: 1,
      title: "Daily sync",
    }, {
      ...behalf,
      lang: "en",
    }),
  );
  out.push(
    await scenario(
      "EN · звука нет",
      { kind: "no_audio", title: "Daily sync" },
      { ...behalf, lang: "en" },
    ),
  );
  return out;
}

// ── Запуск стенда ─────────────────────────────────────────────────────────────

async function waitReady(deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT_FN}/meeting-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function main(): Promise<void> {
  const db = await startDb();
  const tg = startTelegram();
  const fnPath =
    new URL("../supabase/functions/meeting-notice/index.ts", import.meta.url)
      .pathname;
  const child = new Deno.Command("deno", {
    args: ["run", "--allow-all", fnPath],
    env: {
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORT_FN}`,
      SUPABASE_URL: `http://127.0.0.1:${PORT_DB}`,
      SUPABASE_SERVICE_ROLE_KEY: "smoke-service-role-key",
      TELEGRAM_BOT_TOKEN: "smoke-telegram-token",
      TELEGRAM_API_BASE: `http://127.0.0.1:${PORT_TG}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  let outcomes: Outcome[] = [];
  let ready = false;
  try {
    ready = await waitReady(20_000);
    if (ready) outcomes = await runScenarios();
  } finally {
    child.kill("SIGTERM");
    await child.status;
    await db.shutdown();
    await tg.shutdown();
  }

  if (!ready) {
    console.error(
      `КРАСНЫЙ: функция не поднялась на порту ${PORT_FN} за 20 с — проверять нечего.`,
    );
    Deno.exit(1);
  }

  console.log(`\n════ сценарии отказа (${outcomes.length})\n`);
  for (const o of outcomes) {
    console.log(
      `${
        o.problem === null ? "✔" : "✘"
      } ${o.name} [HTTP ${o.status}]\n   ${o.signal}`,
    );
    if (o.problem !== null) console.log(`   ✘ ${o.problem}`);
    console.log("");
  }
  const broken = outcomes.filter((o) => o.problem !== null);
  if (broken.length > 0) {
    console.error(`КРАСНЫЙ: не сошлись ${broken.length} сценариев:`);
    for (const o of broken) console.error(`  ✘ ${o.name}: ${o.problem}`);
    Deno.exit(1);
  }
  console.log(
    `ЗЕЛЁНЫЙ: ${outcomes.length} сценариев, каждый закончился сигналом человеку либо внятным отказом.`,
  );
}

await main();
