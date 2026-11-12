// Ручка meeting-notice: единственная поверхность блока notices.
//
// Здесь проверяется не «сообщение красивое», а то, что уже было источником молчаливого сбоя или
// спама в этом продукте:
//   • решение «слать или хватит» — за базой (meeting_notice_reserve): ручка передаёт ей
//     получателя из личности и все потолки, а её отказ доводит до бота как 409 «уходи».
//     Сами потолки под параллельным натиском держит живой смоук scripts/scriba-notices-smoke.ts;
//   • встреча сверяется: воркспейс агента, владелец — тот, кому уходит сообщение;
//   • получатель НЕ приходит из тела запроса — иначе токен бота становится рассылкой по людям;
//   • отказ доставки виден вызывающему и не съедает единственный повтор.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ON_BEHALF_OF_HEADER, sha256Hex } from "../_shared/agent-auth.ts";
import { NOTICE_LIMITS } from "../_shared/notices.ts";
import { handleNotice } from "./handle.ts";

const BOT_TOKEN = "scriba-container-secret";
const HUMAN_TOKEN = "recorder-token-of-a-real-person";
const OWNER = { telegram_id: 111, group_id: "alpha" };
const MEETING = "5f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const FOREIGN_WS = "6f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const FOREIGN_OWNER = "7f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const KEY = "abc123@google.com:2026-09-23";
// Вторая встреча того же владельца в том же воркспейсе: её пропуск бота на MEETING не открывает.
const OWN_OTHER = "8f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
/** Пропуск бота (T165): токен → встреча, к которой он привязан, или ключ события до заявки. */
const grantToken = (meeting: string | null, key: string | null = null) => `sgr_${meeting ?? "none"}_${key ?? "none"}`;

type Row = Record<string, unknown>;

/** Встречи и журнал — живые таблицы в памяти; личность — как её ищет agent-auth. */
interface Store {
  meetings: Row[];
  meeting_notices: Row[];
  /** Задания календаря: `notice_recipients` — принявшие встречу, которым тоже уходят нотисы бота. */
  meeting_calendar_jobs: Row[];
  /** Что ответит функция резерва. По умолчанию — занять слот с номером 1. */
  reserve?: (args: Row) => { data: unknown; error: { code: string; message: string } | null };
  /** С какими аргументами звали резерв. */
  reserveCalls: Row[];
  /** Участники воркспейсов (`allowed_users`): из них сервер выбирает со-получателей. */
  allowedUsers: Row[];
  /** Какие таблицы записывали (insert/update) — «встречи самостоятельны» проверяется по этому списку. */
  writes: string[];
  /** Ломает чтение участников воркспейса. */
  failAllowedUsersRead?: boolean;
  /** Ломает чтение задания календаря. */
  failJobsRead?: boolean;
}

function newStore(): Store {
  return {
    meetings: [
      { id: MEETING, title: "Weekly sync", group_id: "alpha", claim_owner: OWNER.telegram_id },
      { id: FOREIGN_WS, title: "Board", group_id: "beta", claim_owner: OWNER.telegram_id },
      { id: FOREIGN_OWNER, title: "Salary review", group_id: "alpha", claim_owner: 222 },
      { id: OWN_OTHER, title: "Another meeting", group_id: "alpha", claim_owner: OWNER.telegram_id },
    ],
    meeting_notices: [],
    meeting_calendar_jobs: [],
    reserveCalls: [],
    allowedUsers: [],
    writes: [],
  };
}

type Filter = (row: Row) => boolean;

/** Минимальный построитель запроса поверх массива: eq/neq/gte, select, insert, update. */
function tableQuery(store: Store, table: "meetings" | "meeting_notices" | "meeting_calendar_jobs") {
  const filters: Filter[] = [];
  let pending: { insert?: Row; update?: Row } = {};
  const rows = () => store[table].filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (pending.update) {
      for (const r of rows()) Object.assign(r, pending.update);
      return { data: null, error: null };
    }
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
    maybeSingle: () =>
      store.failJobsRead && table === "meeting_calendar_jobs"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => ((pending = { insert: row }), store.writes.push(table), q),
    update: (patch: Row) => ((pending = { update: patch }), store.writes.push(table), q),
    single: () => {
      const row = pending.insert!;
      const clash = store.meeting_notices.some((r) =>
        r.status !== "failed" && r.recipient_id === row.recipient_id && r.kind === row.kind &&
        r.attempt === row.attempt && r.meeting_id === row.meeting_id && r.meeting_key === row.meeting_key
      );
      if (clash) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      const saved = { id: store.meeting_notices.length + 1, sent_at: new Date().toISOString(), ...row };
      store.meeting_notices.push(saved);
      return Promise.resolve({ data: { id: saved.id }, error: null });
    },
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
  };
  return q;
}

/** Поддельная база: личность как в agent-auth, встречи и журнал — из store. */
async function makeSupabase(store: Store = newStore()): Promise<SupabaseClient> {
  const botHash = await sha256Hex(BOT_TOKEN);
  const humanHash = await sha256Hex(HUMAN_TOKEN);
  const agent = {
    id: "scriba-1",
    name: "scriba",
    group_id: "alpha",
    token_hash: botHash,
    token_expires_at: null,
    is_active: true,
  };
  const human = {
    telegram_id: OWNER.telegram_id,
    group_id: OWNER.group_id,
    claude_mcp_token_hash: null,
    claude_mcp_token_expires_at: null,
    recorder_token_hash: humanHash,
    recorder_token_expires_at: null,
    recorder_token_prev_hash: null,
    recorder_token_prev_expires_at: null,
  };
  const client = {
    rpc(fn: string, args: Row) {
      if (fn !== "meeting_notice_reserve") throw new Error(`unexpected rpc ${fn}`);
      store.reserveCalls.push(args);
      if (store.reserve) return Promise.resolve(store.reserve(args));
      const id = store.meeting_notices.length + 1;
      store.meeting_notices.push({ id, status: "sending", ...args });
      return Promise.resolve({ data: { id, attempt: 1 }, error: null });
    },
    from(table: string) {
      if (table === "meetings" || table === "meeting_notices" || table === "meeting_calendar_jobs") {
        return tableQuery(store, table);
      }
      let byToken: string | null = null;
      let byId: number | null = null;
      let byAgentId: string | null = null;
      let groupEq: string | null = null;
      let inIds: number[] | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        or: (expr: string) => {
          byToken = expr.includes(humanHash) ? humanHash : "other";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (column === "token_hash") byToken = String(value);
          if (column === "telegram_id") byId = Number(value);
          if (column === "id") byAgentId = String(value);
          if (column === "group_id") groupEq = String(value);
          return builder;
        },
        in: (_column: string, values: number[]) => {
          inIds = values;
          return builder;
        },
        // Чтение списка участников (`.in`) — единственный запрос к allowed_users, который ждут без maybeSingle.
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
          Promise.resolve().then(() => {
            if (store.failAllowedUsersRead) return { data: null, error: { message: "boom" } };
            const rows = store.allowedUsers.filter((u) =>
              (inIds === null || inIds.includes(Number(u.telegram_id))) && (groupEq === null || u.group_id === groupEq)
            );
            return { data: rows, error: null };
          }).then(ok, bad),
        maybeSingle: async () => {
          let data: Row | null = null;
          if (table === "meeting_agent_grants") {
            for (const m of [MEETING, FOREIGN_WS, FOREIGN_OWNER, OWN_OTHER, null]) {
              for (const k of [KEY, null]) {
                const token = grantToken(m, k);
                if (byToken !== await sha256Hex(token)) continue;
                data = {
                  id: `g-${token}`,
                  token_hash: byToken,
                  agent_id: agent.id,
                  group_id: "alpha",
                  telegram_id: OWNER.telegram_id,
                  invite_id: null,
                  calendar_job_id: "job-1",
                  join_url: "https://meet.google.com/abc-defg-hij",
                  calendar_key: k ?? "other@google.com:2026-09-23",
                  title: "Weekly sync (calendar)",
                  meeting_id: m,
                  expires_at: "2099-01-01T00:00:00Z",
                };
              }
            }
          }
          if (table === "service_agents" && byAgentId === agent.id) data = agent;
          if (table === "allowed_users" && byToken === humanHash) data = human;
          if (table === "allowed_users" && byId === OWNER.telegram_id) {
            data = { telegram_id: OWNER.telegram_id, group_id: OWNER.group_id };
          }
          if (table === "service_agents" && byToken === botHash) data = agent;
          return Promise.resolve({ data });
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

interface Sent {
  chatId: number;
  text: string;
}

function makeDeps(supabase: SupabaseClient, fail?: string) {
  const sent: Sent[] = [];
  const state = { fail };
  const deps = {
    supabase,
    sendTelegram: (chatId: number, text: string): Promise<void> => {
      if (state.fail !== undefined) return Promise.reject(new Error(state.fail));
      sent.push({ chatId, text });
      return Promise.resolve();
    },
  };
  return { deps, sent, state };
}

function request(body: unknown, opts: { token?: string; onBehalfOf?: number; method?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", `Bearer ${opts.token ?? BOT_TOKEN}`);
  if (opts.onBehalfOf !== undefined) headers.set(ON_BEHALF_OF_HEADER, String(opts.onBehalfOf));
  const method = opts.method ?? "POST";
  return new Request("http://localhost/meeting-notice", {
    method,
    headers,
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

/** Запрос бота от имени владельца — с пропуском встречи (по умолчанию привязан к MEETING). */
function asBot(body: unknown, grant: string = grantToken(MEETING)): Request {
  return request(body, { token: grant, onBehalfOf: OWNER.telegram_id });
}

async function payload(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ── Дверь: первое, ровно один повтор — по журналу сервера ─────────────────────

Deno.test("бот у двери: уведомление уходит владельцу с названием из встречи, ответ ведёт бота дальше", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200);
  assertEquals(await payload(res), {
    ok: true,
    delivered: true,
    attempt: 1,
    should_leave: false,
    next_reminder_in_s: 180,
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].chatId, OWNER.telegram_id);
  assert(sent[0].text.includes("Weekly sync"), sent[0].text);
});

Deno.test("БЛОКИРУЮЩИЙ: сбой Telegram — 502 с причиной, слот помечен failed и не сгорает", async () => {
  const store = newStore();
  const { deps } = makeDeps(await makeSupabase(store), "telegram 429: too many requests");
  const failed = await handleNotice(asBot({ kind: "container_died", meeting_id: MEETING }), deps);
  assertEquals(failed.status, 502, "недоставленное уведомление отчиталось успехом — человек не узнает ничего");
  const body = await payload(failed);
  assertEquals(body.delivered, false);
  assert(String(body.error).includes("429"), `причина недоставки должна дойти до вызывающего: ${String(body.error)}`);
  assertEquals(store.meeting_notices[0].status, "failed", "слот остался занят — повтор после сбоя невозможен");
});

Deno.test("доставлено — слот помечен sent", async () => {
  const store = newStore();
  const { deps } = makeDeps(await makeSupabase(store));
  assertEquals((await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps)).status, 200);
  assertEquals(store.meeting_notices[0].status, "sent");
});

// ── Решение за базой ──────────────────────────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: база получает получателя из личности, встречу и ВСЕ потолки", async () => {
  const store = newStore();
  const { deps } = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING, telegram_id: 999 }), deps);
  assertEquals(store.reserveCalls, [{
    p_recipient: OWNER.telegram_id,
    p_meeting_id: MEETING,
    p_meeting_key: null,
    p_kind: "no_audio",
    p_limits: NOTICE_LIMITS,
  }]);
});

Deno.test("до-встречный отказ резервируется по ключу календаря", async () => {
  const store = newStore();
  const { deps } = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "no_owner", meeting_key: KEY }, grantToken(null, KEY)), deps);
  assertEquals(store.reserveCalls[0].p_meeting_id, null);
  assertEquals(store.reserveCalls[0].p_meeting_key, KEY);
});

Deno.test("БЛОКИРУЮЩИЙ: база отказала по потолку — 409, ничего не отправлено, боту сказано уйти", async () => {
  const store = newStore();
  store.reserve = () => ({ data: { refused: "door notice limit reached: one reminder only" }, error: null });
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps);
  assertEquals(res.status, 409);
  assertEquals(sent.length, 0, "база сказала «хватит», а сообщение ушло");
  const body = await payload(res);
  assertEquals(body.should_leave, true, "боту не сказали уйти — он останется висеть у двери");
  assert(String(body.error).includes("one reminder"), String(body.error));
});

Deno.test("повтор у двери: база дала номер 2 — ответ велит уходить", async () => {
  const store = newStore();
  store.reserve = () => ({ data: { id: 7, attempt: 2 }, error: null });
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps);
  const body = await payload(res);
  assertEquals([res.status, body.attempt, body.should_leave, body.next_reminder_in_s], [200, 2, true, null]);
  assertEquals(sent.length, 1);
});

Deno.test("страховочный индекс поймал дубль — 409, ничего не отправлено", async () => {
  const store = newStore();
  store.reserve = () => ({ data: null, error: { code: "23505", message: "duplicate key" } });
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 409);
  assertEquals(sent.length, 0);
});

Deno.test("журнал недоступен или ответил мусором — 503, ничего не отправлено: вслепую не шлём", async () => {
  for (
    const answer of [
      { data: null, error: { code: "08006", message: "db down" } },
      { data: null, error: null },
      { data: { id: "x" }, error: null },
    ]
  ) {
    const store = newStore();
    store.reserve = () => answer;
    const { deps, sent } = makeDeps(await makeSupabase(store));
    const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
    assertEquals(res.status, 503, JSON.stringify(answer));
    assertEquals(sent.length, 0);
  }
});

Deno.test("БЛОКИРУЮЩИЙ: встреча чужого воркспейса — 403, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: FOREIGN_WS }, grantToken(FOREIGN_WS)), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: уведомляемый — не владелец встречи — 403, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    asBot({ kind: "door_denied", meeting_id: FOREIGN_OWNER }, grantToken(FOREIGN_OWNER)),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0, "сообщение о чужой встрече ушло человеку");
});

Deno.test("встречи нет — 404 с подсказкой, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    // Человек: у бота встреча вне пропуска — 403 раньше, чем дело дойдёт до поиска строки.
    request({ kind: "no_audio", meeting_id: "00000000-0000-4000-8000-000000000000" }, { token: HUMAN_TOKEN }),
    deps,
  );
  assertEquals(res.status, 404);
  assertEquals(sent.length, 0);
  assert(String((await payload(res)).error).includes("claim"));
});

Deno.test("БЛОКИРУЮЩИЙ: получатель не берётся из тела запроса", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    asBot({ kind: "no_audio", meeting_id: MEETING, telegram_id: 999, chat_id: 999, owner_id: 999 }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sent[0].chatId, OWNER.telegram_id, "уведомление ушло по id из тела запроса — это рассылка чужим");
});

Deno.test("личный токен человека тоже открывает дверь — без X-On-Behalf-Of", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    request({ kind: "no_conference_link", meeting_key: KEY, title: "Weekly sync" }, { token: HUMAN_TOKEN }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sent[0].chatId, OWNER.telegram_id);
  assert(sent[0].text.includes("Weekly sync"));
});

Deno.test("чужой токен — 401 с внятным текстом, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio", meeting_id: MEETING }, { token: "who-is-this" }), deps);
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
  const body = await payload(res);
  assertEquals(body.ok, false);
  assert(String(body.error).length > 0, "401 без объяснения — тот же молчаливый отказ");
});

Deno.test("токен бота без X-On-Behalf-Of прав не даёт", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0);
});

// ── Пропуск встречи (T165): бот говорит человеку только о встрече своего пропуска ──

Deno.test("БЛОКИРУЮЩИЙ: общий токен агента с X-On-Behalf-Of — 403, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  for (const body of [{ kind: "no_audio", meeting_id: MEETING }, { kind: "no_conference_link", meeting_key: KEY }]) {
    const res = await handleNotice(request(body, { onBehalfOf: OWNER.telegram_id }), deps);
    assertEquals(res.status, 403, JSON.stringify(body));
  }
  assertEquals(sent.length, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: пропуск одной встречи не шлёт уведомление о другой встрече того же человека", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: OWN_OTHER }), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0, "уведомление о встрече вне пропуска ушло человеку");
});

Deno.test("БЛОКИРУЮЩИЙ: до-встречный отказ бота — только по ключу своего пропуска, название — сервера", async () => {
  const store = newStore();
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const other = await handleNotice(
    asBot({ kind: "no_conference_link", meeting_key: "made-up:2026-09-23", title: "x" }, grantToken(null, KEY)),
    deps,
  );
  assertEquals(other.status, 403, "ключ не из пропуска");
  const ok = await handleNotice(
    asBot({ kind: "no_conference_link", meeting_key: KEY, title: "Text from the request body" }, grantToken(null, KEY)),
    deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(sent.length, 1);
  assert(sent[0].text.includes("Weekly sync (calendar)"), sent[0].text);
  assert(!sent[0].text.includes("Text from the request body"), "текст из тела дошёл до человека");
});

Deno.test("неизвестный kind — 400, в ответе видно что прислали, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "vsyo_horosho", meeting_id: MEETING }), deps);
  assertEquals(res.status, 400);
  assertEquals(sent.length, 0);
  assert(String((await payload(res)).error).includes("vsyo_horosho"));
});

Deno.test("тело не JSON — 400, а не 500 и не тишина", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot("{не json"), deps);
  assertEquals(res.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("не POST — 405 с объяснением", async () => {
  const { deps } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio" }, { method: "GET", onBehalfOf: OWNER.telegram_id }), deps);
  assertEquals(res.status, 405);
});

// ── Встречные нотисы — всем участникам встречи (решение 12.11.2026) ────────────

const CO_MEETING = "9f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";

/**
 * Календарное задание встречи MEETING (ключ из пропуска бота — в поддельной базе он «other@google.com:…»): `accepted` — принявшие встречу,
 * которых посчитал meeting-calendar. 222 и 333 — участники воркспейса, -5 — веб без Telegram,
 * 999 — другой воркспейс, 404 — нет в allowed_users.
 */
function withParticipants(store: Store, accepted: number[]): Store {
  store.meeting_calendar_jobs = [{
    group_id: "alpha",
    calendar_key: "other@google.com:2026-09-23",
    notice_recipients: accepted,
  }];
  store.allowedUsers = [
    { telegram_id: OWNER.telegram_id, group_id: "alpha" },
    { telegram_id: 222, group_id: "alpha" },
    { telegram_id: 333, group_id: "alpha" },
    { telegram_id: 999, group_id: "beta" },
  ];
  return store;
}

const chatIds = (sent: Sent[]) => sent.map((m) => m.chatId).sort((a, b) => a - b);

Deno.test("БЛОКИРУЮЩИЙ: встречная нотиса уходит запустившему и принявшим встречу (notice_recipients), без дублей и служебных id", async () => {
  // 111 (запустивший) в списке — дубль; -5 — веб без Telegram; 999 — другой воркспейс; 404 — нет в allowed_users.
  const store = withParticipants(newStore(), [222, 333, 111, 222, -5, 999, 404]);
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "guest_access_closed", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111, 222, 333], "нотиса ушла не всем участникам или ушла лишним");
  assertEquals(store.reserveCalls.map((c) => c.p_recipient).sort(), [111, 222, 333], "потолки считаются на каждого");
});

Deno.test("встречная нотиса: у каждого получателя свой слот в журнале и свой номер отправки", async () => {
  const store = withParticipants(newStore(), [222]);
  store.reserve = (args) => {
    const attempt = args.p_recipient === 222 ? 2 : 1;
    const id = store.meeting_notices.length + 1;
    store.meeting_notices.push({ id, status: "sending", ...args });
    return { data: { id, attempt }, error: null };
  };
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const body = await payload(await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps));
  // Бот получает расписание по номеру ЗАПУСТИВШЕГО: число и номера со-получателей решение «уходить» не меняют.
  assertEquals([body.attempt, body.should_leave], [1, false]);
  const last = sent.find((m) => m.chatId === 222)!;
  assert(last.text.includes("last reminder"), `со-участнику с номером 2 ушёл не последний текст: ${last.text}`);
  assert(!sent.find((m) => m.chatId === 111)!.text.includes("last reminder"));
});

Deno.test("БЛОКИРУЮЩИЙ: недоставка участнику не роняет доставку запустившему и не даёт боту 502", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  const base = makeDeps(await makeSupabase(store));
  const sent: number[] = [];
  const deps = {
    ...base.deps,
    sendTelegram: (chatId: number, _text: string) => {
      if (chatId === 222) return Promise.reject(new Error("Forbidden: bot was blocked by the user"));
      sent.push(chatId);
      return Promise.resolve();
    },
  };
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200, "чужая недоставка дала боту ложный сбой");
  assertEquals(sent.sort(), [111, 333]);
  const byRecipient = (id: number) => store.meeting_notices.find((r) => r.recipient_id === id || r.p_recipient === id)!;
  assertEquals(byRecipient(222).status, "failed", "недоставленному слот не освобождён");
  assertEquals(byRecipient(333).status, "sent");
});

Deno.test("БЛОКИРУЮЩИЙ: потолок у участника не мешает запустившему и не меняет ответ боту", async () => {
  const store = withParticipants(newStore(), [222]);
  store.reserve = (args) => {
    if (args.p_recipient === 222) return { data: { refused: "daily notice limit reached" }, error: null };
    const id = store.meeting_notices.length + 1;
    store.meeting_notices.push({ id, status: "sending", ...args });
    return { data: { id, attempt: 1 }, error: null };
  };
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111]);
});

Deno.test("отказ базы запустившему — 409 боту, но участникам нотиса всё равно уходит (у них свой счёт)", async () => {
  const store = withParticipants(newStore(), [222]);
  store.reserve = (args) => {
    if (args.p_recipient === OWNER.telegram_id) return { data: { refused: "already notified" }, error: null };
    const id = store.meeting_notices.length + 1;
    store.meeting_notices.push({ id, status: "sending", ...args });
    return { data: { id, attempt: 1 }, error: null };
  };
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 409);
  assertEquals((await payload(res)).should_leave, true);
  assertEquals(chatIds(sent), [222]);
});

Deno.test("участников не прочитать — нотиса уходит одному запустившему, как раньше", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  store.failAllowedUsersRead = true;
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111]);
});

Deno.test("БЛОКИРУЮЩИЙ: участник с co_owners, но без принятия (его нет в notice_recipients) нотису не получает", async () => {
  const store = withParticipants(newStore(), [222]);
  // 333 — в co_owners встречи (он в приглашении), но встречу не принял: needsAction/tentative/declined.
  store.meetings[0].co_owners = [222, 333];
  const { deps, sent } = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(chatIds(sent), [111, 222]);
});

Deno.test("запрос человека (не бота) и встреча без задания — только запустившему, задание не читается", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  store.failJobsRead = true;
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(request({ kind: "no_audio", meeting_id: MEETING }, { token: HUMAN_TOKEN }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111]);
});

Deno.test("задание не прочитать — нотиса уходит одному запустившему", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  store.failJobsRead = true;
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111]);
});

Deno.test("до-встречный отказ — только запустившему, со-участники не читаются", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  const { deps, sent } = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "no_owner", meeting_key: KEY }, grantToken(null, KEY)), deps);
  assertEquals(chatIds(sent), [111]);
});

Deno.test("guest_access_waiting — встречная нотиса: у каждого получателя название встречи, имя бота подставлено", async () => {
  const store = withParticipants(newStore(), [222]);
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "guest_access_waiting", meeting_id: MEETING, lang: "ru" }), deps);
  assertEquals(res.status, 200);
  assertEquals(chatIds(sent), [111, 222]);
  for (const m of sent) {
    assert(m.text.includes("Weekly sync") && !m.text.includes("{"), m.text);
  }
  // Ранний «стук» — не отказ: бот остаётся ждать открытия комнаты, а не уходит.
  assertEquals((await payload(res)).should_leave, false);
});

Deno.test("БЛОКИРУЮЩИЙ: встречи самостоятельны — нотиса по X пишет только в журнал; Y со-участника и её адресаты не тронуты", async () => {
  const store = withParticipants(newStore(), [222, 333]);
  // Y — параллельная встреча участника 333: свой владелец, свои записавшие, свои со-владельцы.
  store.meetings.push({
    id: CO_MEETING,
    title: "Own call of 333",
    group_id: "alpha",
    claim_owner: 333,
    recorders: [{ telegram_id: 333 }],
    co_owners: [444],
    process_state: "recording",
  });
  const before = JSON.parse(JSON.stringify(store.meetings.slice(1)));
  const { deps, sent } = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps);
  assertEquals(chatIds(sent), [111, 222, 333]);
  assertEquals(
    [...new Set(store.writes)],
    ["meeting_notices"],
    "нотиса записала что-то кроме журнала нотис — например, чужую встречу",
  );
  assertEquals(store.meetings.slice(1), before, "строки других встреч изменились");
  assert(!sent.some((m) => m.chatId === 444), "адресаты Y попали в рассылку по X");
  assert(
    store.meeting_notices.every((r) => (r.meeting_id ?? r.p_meeting_id) === MEETING),
    "в журнал по X попала запись о другой встрече",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: нотиса по Y не меняет получателей нотис по X, и наоборот", async () => {
  const store = withParticipants(newStore(), [222]);
  store.meetings.push({
    id: CO_MEETING,
    title: "Own call of 222",
    group_id: "alpha",
    claim_owner: 222,
    co_owners: [333],
  });
  // У Y свои участники (222 владелец, 333 со-владелец): адресатов X они не расширяют.
  const x = makeDeps(await makeSupabase(store));
  await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), x.deps);
  assertEquals(chatIds(x.sent), [111, 222]);
  assertEquals(
    store.reserveCalls.filter((c) => c.p_meeting_id === MEETING).map((c) => c.p_recipient).sort(),
    [111, 222],
  );
});
