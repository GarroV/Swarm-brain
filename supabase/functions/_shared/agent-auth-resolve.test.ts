// deno-lint-ignore-file no-import-prefix -- правило требует голых спецификаторов из
// import-map, но edge-функции Swarm деплоятся с URL-импортами (так во ВСЕХ функциях без
// исключения) и проверить деплой с голым спецификатором из ветки нельзя. Перевод импортов ради
// линта = непроверяемый риск для живого конвейера. Дефект гейта вынесен диспетчеру.
// Блокирующие тесты подмены личности (resolveActingIdentity).
//
// Вынесены отдельным файлом намеренно: это единственное место, где расширяется авторизация, и
// список «что боту запрещено» должен читаться подряд, а не выуживаться из тестов классификатора.
// Красный файл = блок не сдаётся, даже если всё остальное зелёное.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AgentAuthError,
  ON_BEHALF_OF_HEADER,
  resolveActingIdentity,
  sha256Hex,
  verifyAgentToken,
} from "./agent-auth.ts";

// ── Стенд ─────────────────────────────────────────────────────────────────────

const HUMAN_TOKEN = "recorder-token-of-a-real-person";
const MCP_TOKEN = "smcp_personal_token";
const BOT_TOKEN = "scriba-container-secret";

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
        const byId = calls.find((c) =>
          c.method === "eq" && c.args[0] === "telegram_id"
        );
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
  assertEquals(
    e.message.includes(ON_BEHALF_OF_HEADER),
    true,
    `отказ обязан назвать, чего не хватает: «${e.message}»`,
  );
  assertEquals(
    personLookups,
    [],
    "без подмены в таблицу людей не ходим вообще",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: бот не может указать человека из чужого воркспейса", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 222)),
    403,
    "чужой воркспейс",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: бот не может указать человека без воркспейса", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 333)),
    403,
    "человек без воркспейса",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: бот без воркспейса не действует ни за кого", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow({ group_id: null }),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 111)),
    403,
    "бот без воркспейса",
  );
});

Deno.test("бот не может указать несуществующего человека", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 999)),
    403,
    "неизвестный человек",
  );
});

Deno.test("на выходе — человек, а не бот: telegramId и воркспейс принадлежат человеку", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  assertEquals(await resolveActingIdentity(client, req(BOT_TOKEN, 111)), {
    telegramId: 111,
    groupId: "alpha",
    kind: "bot",
    agentId: "scriba",
  });
});

Deno.test("выключенный агент не проходит, хотя токен верный", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow({ is_active: false }),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 111)),
    401,
    "выключенный агент",
  );
});

Deno.test("истёкший токен агента не проходит", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow({ token_expires_at: "2020-01-01T00:00:00Z" }),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 111)),
    401,
    "истёкший токен агента",
  );
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
    agentByToken: await botRow(),
    personById: people,
  });
  for (const junk of ["abc", "0", "-5", "1.5", "111; drop"]) {
    await refuses(
      resolveActingIdentity(client, req(BOT_TOKEN, junk)),
      403,
      `мусор «${junk}»`,
    );
  }
});

Deno.test("заголовок и аргумент расходятся — отказ, а не тихий выбор одного из двух", async () => {
  const { client } = makeSupabase({
    agentByToken: await botRow(),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 222), 111),
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

Deno.test("строка агента найдена, но хэш не её — 401, а не личность агента", async () => {
  // Защита от запроса, который вернул не ту строку: доверяем сверке хэша, а не факту ответа базы.
  const { client } = makeSupabase({
    agentByToken: await botRow({ token_hash: "somebody-elses-hash" }),
    personById: people,
  });
  await refuses(
    resolveActingIdentity(client, req(BOT_TOKEN, 111)),
    401,
    "хэш не совпал",
  );
});
