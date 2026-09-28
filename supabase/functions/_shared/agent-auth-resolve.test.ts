// import-map, но edge-функции Swarm деплоятся с URL-импортами (так во ВСЕХ функциях без
// исключения) и проверить деплой с голым спецификатором из ветки нельзя. Перевод импортов ради
// линта = непроверяемый риск для живого конвейера. Дефект гейта вынесен диспетчеру.
// Блокирующие тесты подмены личности (resolveActingIdentity).
//
// Вынесены отдельным файлом намеренно: это единственное место, где расширяется авторизация, и
// список «что боту запрещено» должен читаться подряд, а не выуживаться из тестов классификатора.
// Красный файл = блок не сдаётся, даже если всё остальное зелёное.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AgentAuthError,
  ON_BEHALF_OF_HEADER,
  resolveActingIdentity,
  resolveServiceAgent,
  sha256Hex,
  verifyAgentToken,
} from "./agent-auth.ts";
import type { AgentGrant } from "./agent-grant.ts";

// ── Стенд ─────────────────────────────────────────────────────────────────────

const HUMAN_TOKEN = "recorder-token-of-a-real-person";
const MCP_TOKEN = "smcp_personal_token";
const BOT_TOKEN = "scriba-orchestrator-secret";
const GRANT_TOKEN = "sgr_one-meeting-pass";

const HUMAN = { telegram_id: 111, group_id: "alpha" };
const OUTSIDER = { telegram_id: 222, group_id: "beta" };
const HOMELESS = { telegram_id: 333, group_id: null };

type Row = Record<string, unknown> | null;
type Call = { method: string; args: unknown[] };

/**
 * Поддельный Supabase: маршрутизирует запрос по таблице и по тому, чем его сузили.
 * Так тест видит РАЗНИЦУ между «найди владельца токена» и «найди человека по telegram_id» —
 * оба идут в allowed_users, и подмена одного другим прошла бы незамеченной.
 */
function makeSupabase(opts: {
  userByToken?: Row;
  agentByToken?: Row;
  grantByToken?: Row;
  personById?: (id: number) => Row;
}): { client: SupabaseClient; updates: Call[]; personLookups: unknown[] } {
  const updates: Call[] = [];
  const personLookups: unknown[] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "or", "eq"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push({ method: m, args });
          return builder;
        };
      }
      builder.update = (...args: unknown[]) => {
        updates.push({ method: `${table}.update`, args });
        return builder;
      };
      builder.maybeSingle = () => {
        if (table === "service_agents") {
          return Promise.resolve({ data: opts.agentByToken ?? null });
        }
        if (table === "meeting_agent_grants") {
          return Promise.resolve({ data: opts.grantByToken ?? null });
        }
        const byId = calls.find((c) => c.method === "eq" && c.args[0] === "telegram_id");
        if (byId) {
          const id = byId.args[1] as number;
          personLookups.push(id);
          return Promise.resolve({ data: opts.personById?.(id) ?? null });
        }
        return Promise.resolve({ data: opts.userByToken ?? null });
      };
      // update().eq() завершается без maybeSingle — сделаем его ожидаемым
      builder.then = undefined;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, updates, personLookups };
}

const people = (id: number): Row => {
  for (const p of [HUMAN, OUTSIDER, HOMELESS]) {
    if (p.telegram_id === id) return { ...p };
  }
  return null;
};

async function userRow(over: Record<string, unknown> = {}) {
  return {
    ...HUMAN,
    claude_mcp_token_hash: await sha256Hex(MCP_TOKEN),
    claude_mcp_token_expires_at: null,
    recorder_token_hash: await sha256Hex(HUMAN_TOKEN),
    recorder_token_expires_at: null,
    recorder_token_prev_hash: null,
    recorder_token_prev_expires_at: null,
    ...over,
  };
}

async function botRow(over: Record<string, unknown> = {}) {
  return {
    id: "scriba",
    name: "scriba",
    group_id: "alpha",
    token_hash: await sha256Hex(BOT_TOKEN),
    token_expires_at: null,
    is_active: true,
    ...over,
  };
}

async function grantRow(over: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    token_hash: await sha256Hex(GRANT_TOKEN),
    agent_id: "scriba",
    group_id: "alpha",
    telegram_id: 111,
    invite_id: null,
    calendar_job_id: "job-1",
    join_url: "https://meet.google.com/abc-defg-hij",
    calendar_key: "standup@google.com:2026-09-28",
    title: "Standup",
    meeting_id: null,
    expires_at: "2099-01-01T00:00:00Z",
    ...over,
  };
}

/** Всё, что пропуск несёт в дверь: основание, ключ, название — из строки сервера. */
const GRANT: AgentGrant = {
  id: "grant-1",
  agentId: "scriba",
  basis: "calendar",
  inviteId: null,
  calendarKey: "standup@google.com:2026-09-28",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  title: "Standup",
  meetingId: null,
};

function req(token: string, onBehalfOf?: number | string): Request {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (onBehalfOf !== undefined) {
    headers.set(ON_BEHALF_OF_HEADER, String(onBehalfOf));
  }
  return new Request("https://example.test/meeting-claim", {
    method: "POST",
    headers,
  });
}

async function refuses(
  p: Promise<unknown>,
  status: 401 | 403,
  hint: string,
): Promise<void> {
  const e = await assertRejects(
    () => p,
    AgentAuthError,
    undefined,
    hint,
  ) as AgentAuthError;
  assertEquals(
    e.status,
    status,
    `${hint}: ожидался ${status}, пришёл ${e.status}`,
  );
}

// ── Человек с личным токеном ──────────────────────────────────────────────────

Deno.test("личный токен рекордера работает как раньше — личность его владельца", async () => {
  const { client } = makeSupabase({ userByToken: await userRow() });
  assertEquals(await resolveActingIdentity(client, req(HUMAN_TOKEN)), {
    telegramId: 111,
    groupId: "alpha",
    kind: "recorder",
  });
});

Deno.test("БЛОКИРУЮЩИЙ: токен рекордера не может действовать за другого — 403", async () => {
  const { client } = makeSupabase({
    userByToken: await userRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(HUMAN_TOKEN, 222)),
    403,
    "рекордер с заголовком подмены",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: подмена запрещена рекордеру и когда её передают аргументом", async () => {
  const { client } = makeSupabase({
    userByToken: await userRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(HUMAN_TOKEN), 222),
    403,
    "рекордер с on_behalf_of аргументом",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: рекордеру запрещено действовать даже за самого себя", async () => {
  // Иначе появляется второй путь к своей же личности, и разница между «я» и «за меня»
  // перестаёт быть проверяемой: логи и claim_owner будут одинаковы у обоих.
  const { client } = makeSupabase({
    userByToken: await userRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(HUMAN_TOKEN, 111)),
    403,
    "рекордер за себя",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: MCP-токен Claude Desktop тоже не может действовать за другого", async () => {
  const { client } = makeSupabase({
    userByToken: await userRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(MCP_TOKEN, 222)),
    403,
    "mcp с подменой",
  );
});

// ── Токен служебного агента ───────────────────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: токен бота без on_behalf_of не даёт прав ни на что", async () => {
  // Одного 403 тут мало: без подмены запрос и так упрётся в «неизвестный человек» дальше по
  // коду, и тест зеленел бы при СНЯТОЙ проверке (проверено порчей — снятие guard'а не краснело).
  // Поэтому проверяем причину: отказ назван, и до поиска человека дело не дошло вовсе.
  const { client, personLookups } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  const e = await assertRejects(
    () => resolveActingIdentity(client, req(BOT_TOKEN)),
    AgentAuthError,
  ) as AgentAuthError;
  assertEquals(e.status, 403);
  assertEquals(e.message.includes("meeting grant"), true, `отказ обязан назвать, чего не хватает: «${e.message}»`);
  assertEquals(personLookups, [], "без пропуска в таблицу людей не ходим вообще");
});

Deno.test("БЛОКИРУЮЩИЙ: общий токен агента не действует за человека и с X-On-Behalf-Of (T165)", async () => {
  // Заголовок — слово бота, а не основание сервера: за человека бот ходит только по пропуску
  // встречи, который сервер выдал там, где человек позвал бота или включил автозапуск.
  for (const id of [111, 222, 333, 999]) {
    const { client, personLookups } = makeSupabase({ agentByToken: await botRow(), personById: people });
    await refuses(resolveActingIdentity(client, req(BOT_TOKEN, id)), 403, `общий токен за ${id}`);
    assertEquals(personLookups, [], "человека по слову бота не ищем");
  }
});

Deno.test("пропуск встречи — личность человека пропуска и сам пропуск", async () => {
  const { client } = makeSupabase({ grantByToken: await grantRow(), agentByToken: await botRow(), personById: people });
  assertEquals(await resolveActingIdentity(client, req(GRANT_TOKEN)), {
    telegramId: 111,
    groupId: "alpha",
    kind: "bot",
    agentId: "scriba",
    grant: GRANT,
  });
  // Бот по-прежнему шлёт X-On-Behalf-Of — совпадающий заголовок не мешает.
  const again = makeSupabase({ grantByToken: await grantRow(), agentByToken: await botRow(), personById: people });
  assertEquals((await resolveActingIdentity(again.client, req(GRANT_TOKEN, 111))).telegramId, 111);
});

Deno.test("пропуск по приглашению несёт приглашение, а не ключ календаря", async () => {
  const row = await grantRow({ invite_id: "inv-1", calendar_job_id: null, calendar_key: null, title: null });
  const { client } = makeSupabase({ grantByToken: row, agentByToken: await botRow(), personById: people });
  const { grant } = await resolveActingIdentity(client, req(GRANT_TOKEN));
  assertEquals(grant, { ...GRANT, basis: "invite" as const, inviteId: "inv-1", calendarKey: null, title: null });
});

Deno.test("БЛОКИРУЮЩИЙ: пропуск одного человека не действует за другого", async () => {
  const { client } = makeSupabase({ grantByToken: await grantRow(), agentByToken: await botRow(), personById: people });
  await refuses(resolveActingIdentity(client, req(GRANT_TOKEN, 222)), 403, "заголовок за другого");
  const arg = makeSupabase({ grantByToken: await grantRow(), agentByToken: await botRow(), personById: people });
  await refuses(resolveActingIdentity(arg.client, req(GRANT_TOKEN), 222), 403, "аргумент за другого");
});

Deno.test("БЛОКИРУЮЩИЙ: человек пропуска вне воркспейса пропуска — отказ, один текст на все причины", async () => {
  // Разные тексты превращали бы отказ в оракул «заведён ли человек» (см. тест ниже про подмену).
  const messages: string[] = [];
  for (const id of [999, 222, 333]) { // не заведён · чужой воркспейс · без воркспейса
    const { client } = makeSupabase({
      grantByToken: await grantRow({ telegram_id: id }),
      agentByToken: await botRow(),
      personById: people,
    });
    const e = await assertRejects(
      () => resolveActingIdentity(client, req(GRANT_TOKEN)),
      AgentAuthError,
    ) as AgentAuthError;
    assertEquals(e.status, 403, `человек ${id}`);
    messages.push(e.message);
  }
  assertEquals(new Set(messages).size, 1, JSON.stringify(messages));
});

Deno.test("истёкший пропуск не действует", async () => {
  const { client } = makeSupabase({
    grantByToken: await grantRow({ expires_at: "2020-01-01T00:00:00Z" }),
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(resolveActingIdentity(client, req(GRANT_TOKEN)), 401, "истёкший пропуск");
});

Deno.test("БЛОКИРУЮЩИЙ: выключенный или истёкший агент гасит свои пропуска", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["выключен", { is_active: false }],
    ["токен истёк", { token_expires_at: "2020-01-01T00:00:00Z" }],
    ["другой воркспейс", { group_id: "beta" }],
  ];
  for (const [what, over] of cases) {
    const { client } = makeSupabase({
      grantByToken: await grantRow(),
      agentByToken: await botRow(over),
      personById: people,
    });
    await refuses(resolveActingIdentity(client, req(GRANT_TOKEN)), 401, `агент: ${what}`);
  }
});

Deno.test("строка пропуска найдена, но хэш не её — 401", async () => {
  const { client } = makeSupabase({
    grantByToken: await grantRow({ token_hash: "somebody-elses-hash" }),
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(resolveActingIdentity(client, req(GRANT_TOKEN)), 401, "хэш пропуска не совпал");
});

Deno.test("БЛОКИРУЮЩИЙ: пропуск не открывает ни дверь людей, ни дверь оркестратора", async () => {
  const opts = async () => ({ grantByToken: await grantRow(), agentByToken: null, personById: people });
  await refuses(verifyAgentToken(makeSupabase(await opts()).client, req(GRANT_TOKEN)), 401, "дверь людей");
  await refuses(resolveServiceAgent(makeSupabase(await opts()).client, req(GRANT_TOKEN)), 401, "дверь оркестратора");
});

// ── Границы входа ─────────────────────────────────────────────────────────────

Deno.test("неизвестный токен — 401 и ни слова о том, чей он", async () => {
  const { client } = makeSupabase({ personById: people });
  await refuses(
    resolveActingIdentity(client, req("stranger", 111)),
    401,
    "чужой токен",
  );
});

Deno.test("без заголовка Authorization — 401", async () => {
  const { client } = makeSupabase({ userByToken: await userRow() });
  const bare = new Request("https://example.test/x", { method: "POST" });
  await refuses(resolveActingIdentity(client, bare), 401, "без токена");
});

Deno.test("мусор в заголовке подмены — внятный отказ, а не молчаливое игнорирование", async () => {
  // Молча проигнорированный заголовок = бот пишет встречу «ничью» и никто не узнал.
  const { client } = makeSupabase({
    grantByToken: await grantRow(),
    agentByToken: await botRow(),
    personById: people,
  });
  for (const junk of ["abc", "0", "-5", "1.5", "111; drop"]) {
    await refuses(
      resolveActingIdentity(client, req(GRANT_TOKEN, junk)),
      403,
      `мусор «${junk}»`,
    );
  }
});

Deno.test("заголовок и аргумент расходятся — отказ, а не тихий выбор одного из двух", async () => {
  const { client } = makeSupabase({
    grantByToken: await grantRow(),
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(GRANT_TOKEN, 222), 111),
    403,
    "конфликт источников",
  );
});

// ── verifyAgentToken: дверь только для людей ─────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: verifyAgentToken не пускает бота — иначе он выменял бы веб-сессию человека", async () => {
  // meeting-webtoken печатает по этой двери JWT браузерной сессии на 7 дней. Бот, получивший
  // её, перестал бы быть «записывающим за человека» и стал бы этим человеком в вебе.
  // Отказ обязан быть в ОБОИХ видах: и когда бот просит подмену, и когда просто приходит с токеном.
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    verifyAgentToken(client, req(BOT_TOKEN, 111)),
    403,
    "бот с подменой",
  );
  await refuses(
    verifyAgentToken(client, req(BOT_TOKEN)),
    401,
    "бот без подмены",
  );
});

Deno.test("verifyAgentToken отбивает заголовок подмены и у человеческого токена", async () => {
  const { client } = makeSupabase({
    userByToken: await userRow(),
    personById: people,
  });
  await refuses(
    verifyAgentToken(client, req(HUMAN_TOKEN, 111)),
    403,
    "подмена на старой двери",
  );
});

Deno.test("verifyAgentToken без подмены работает как раньше", async () => {
  const { client } = makeSupabase({ userByToken: await userRow() });
  assertEquals(await verifyAgentToken(client, req(HUMAN_TOKEN)), {
    telegramId: 111,
    groupId: "alpha",
    kind: "recorder",
  });
});

// ── Жизненный цикл личного токена (существующее поведение, теперь под тестом) ─

Deno.test("пустой заголовок подмены = заголовка нет: человеку он не мешает", async () => {
  const { client } = makeSupabase({ userByToken: await userRow() });
  const headers = new Headers({
    Authorization: `Bearer ${HUMAN_TOKEN}`,
    [ON_BEHALF_OF_HEADER]: "   ",
  });
  const r = new Request("https://example.test/x", { method: "POST", headers });
  assertEquals((await resolveActingIdentity(client, r)).telegramId, 111);
});

Deno.test("истёкший личный токен — 401 и подсказка, где взять новый", async () => {
  const { client } = makeSupabase({
    userByToken: await userRow({
      recorder_token_expires_at: "2020-01-01T00:00:00Z",
    }),
  });
  const e = await assertRejects(
    () => resolveActingIdentity(client, req(HUMAN_TOKEN)),
    AgentAuthError,
  ) as AgentAuthError;
  assertEquals(e.status, 401);
  assertEquals(
    e.message.includes("/recordertoken"),
    true,
    "человеку сказано, что делать",
  );
});

Deno.test("перекрытие при перевыпуске: предыдущий токен работает и гасится входом нового", async () => {
  const prev = await sha256Hex("previous-recorder-token");
  const withOverlap = await userRow({
    recorder_token_prev_hash: prev,
    recorder_token_prev_expires_at: "2099-01-01T00:00:00Z",
  });

  const old = makeSupabase({ userByToken: withOverlap });
  assertEquals(
    (await resolveActingIdentity(old.client, req("previous-recorder-token")))
      .kind,
    "recorder_prev",
  );
  assertEquals(old.updates.length, 0, "предыдущим токеном перекрытие не гасим");

  const fresh = makeSupabase({ userByToken: withOverlap });
  assertEquals(
    (await resolveActingIdentity(fresh.client, req(HUMAN_TOKEN))).kind,
    "recorder",
  );
  assertEquals(
    fresh.updates.length,
    1,
    "вход новым токеном гасит перекрытие немедленно",
  );
});

// ── Дверь агента «сам за себя» (resolveServiceAgent, D017) ────────────────────
// Оркестратор забирает приглашения СВОЕГО воркспейса, ни за кого не действуя. Дверь отдаёт только
// агента и его воркспейс — человеческой личности на выходе нет, и люди в неё не проходят.

Deno.test("агент без подмены проходит в свою дверь — на выходе агент и его воркспейс", async () => {
  const { client } = makeSupabase({ agentByToken: await botRow(), personById: people });
  assertEquals(await resolveServiceAgent(client, req(BOT_TOKEN)), { agentId: "scriba", groupId: "alpha" });
});

Deno.test("БЛОКИРУЮЩИЙ: личные токены (рекордер, MCP) в дверь агента не проходят", async () => {
  for (const token of [HUMAN_TOKEN, MCP_TOKEN]) {
    const { client } = makeSupabase({ userByToken: await userRow(), personById: people });
    await refuses(resolveServiceAgent(client, req(token)), 401, `личный токен ${token}`);
  }
});

Deno.test("БЛОКИРУЮЩИЙ: в двери агента подмена личности не принимается", async () => {
  const { client } = makeSupabase({ agentByToken: await botRow(), personById: people });
  await refuses(resolveServiceAgent(client, req(BOT_TOKEN, 111)), 403, "агент с X-On-Behalf-Of");
});

Deno.test("БЛОКИРУЮЩИЙ: агент без воркспейса не получает ничего", async () => {
  const { client } = makeSupabase({ agentByToken: await botRow({ group_id: null }), personById: people });
  await refuses(resolveServiceAgent(client, req(BOT_TOKEN)), 403, "агент без воркспейса");
});

Deno.test("выключенный агент в свою дверь не проходит", async () => {
  const { client } = makeSupabase({ agentByToken: await botRow({ is_active: false }), personById: people });
  await refuses(resolveServiceAgent(client, req(BOT_TOKEN)), 401, "выключенный агент");
});
