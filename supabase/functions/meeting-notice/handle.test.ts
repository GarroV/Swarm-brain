// Ручка meeting-notice: единственная поверхность блока notices.
//
// Здесь проверяется не «сообщение красивое», а то, что уже было источником молчаливого сбоя или
// спама в этом продукте:
//   • потолок держит СЕРВЕР по своему журналу: зацикленный контейнер, сколько бы раз ни прислал
//     «дверь», получит ровно два сообщения на встречу — и одно при гонке двух вызовов;
//   • встреча сверяется: воркспейс агента, владелец — тот, кому уходит сообщение;
//   • получатель НЕ приходит из тела запроса — иначе токен бота становится рассылкой по людям;
//   • отказ доставки виден вызывающему и не съедает единственный повтор.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ON_BEHALF_OF_HEADER, sha256Hex } from "../_shared/agent-auth.ts";
import { DOOR_MAX_ATTEMPTS, MAX_PER_RECIPIENT_PER_DAY, MAX_UNBOUND_PER_RECIPIENT_PER_DAY } from "../_shared/notices.ts";
import { handleNotice } from "./handle.ts";

const BOT_TOKEN = "scriba-container-secret";
const HUMAN_TOKEN = "recorder-token-of-a-real-person";
const OWNER = { telegram_id: 111, group_id: "alpha" };
const MEETING = "5f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const FOREIGN_WS = "6f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const FOREIGN_OWNER = "7f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const KEY = "abc123@google.com:2026-09-23";

type Row = Record<string, unknown>;

/** Встречи и журнал — живые таблицы в памяти; личность — как её ищет agent-auth. */
interface Store {
  meetings: Row[];
  meeting_notices: Row[];
  failInsert?: boolean;
}

function newStore(): Store {
  return {
    meetings: [
      { id: MEETING, title: "Weekly sync", group_id: "alpha", claim_owner: OWNER.telegram_id },
      { id: FOREIGN_WS, title: "Board", group_id: "beta", claim_owner: OWNER.telegram_id },
      { id: FOREIGN_OWNER, title: "Salary review", group_id: "alpha", claim_owner: 222 },
    ],
    meeting_notices: [],
  };
}

type Filter = (row: Row) => boolean;

/** Минимальный построитель запроса поверх массива: eq/neq/gte, select, insert, update. */
function tableQuery(store: Store, table: "meetings" | "meeting_notices") {
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
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => ((pending = { insert: row }), q),
    update: (patch: Row) => ((pending = { update: patch }), q),
    single: () => {
      const row = pending.insert!;
      if (store.failInsert) return Promise.resolve({ data: null, error: { code: "08006", message: "db down" } });
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
    from(table: string) {
      if (table === "meetings" || table === "meeting_notices") return tableQuery(store, table);
      let byToken: string | null = null;
      let byId: number | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        or: (expr: string) => {
          byToken = expr.includes(humanHash) ? humanHash : "other";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (column === "token_hash") byToken = String(value);
          if (column === "telegram_id") byId = Number(value);
          return builder;
        },
        maybeSingle: () => {
          let data: Row | null = null;
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

/** Запрос бота от имени владельца. */
function asBot(body: unknown): Request {
  return request(body, { onBehalfOf: OWNER.telegram_id });
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

Deno.test("БЛОКИРУЮЩИЙ: зацикленный контейнер — десять «дверей» подряд дают ровно два сообщения", async () => {
  // Та самая находка приёмки: пока счёт жил в теле запроса, каждая «попытка 1» доходила до
  // человека. Здесь бот ведёт себя худшим образом — и сервер всё равно пропускает два.
  const store = newStore();
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const statuses: number[] = [];
  const answers: Record<string, unknown>[] = [];
  for (let i = 0; i < 10; i++) {
    const res = await handleNotice(asBot({ kind: "door_waiting", meeting_id: MEETING }), deps);
    statuses.push(res.status);
    answers.push(await payload(res));
  }
  assertEquals(sent.length, DOOR_MAX_ATTEMPTS, `человеку ушло ${sent.length} сообщений о двери`);
  assertEquals(statuses, [200, 200, 409, 409, 409, 409, 409, 409, 409, 409]);
  assertEquals(answers[1].should_leave, true, "повтор не велел уйти");
  assertEquals(answers[1].next_reminder_in_s, null);
  assert(sent[0].text !== sent[1].text, "повтор не сказал, что он последний");
  assertEquals(answers[9].should_leave, true, "отказ не велел уйти — бот останется у двери");
});

Deno.test("БЛОКИРУЮЩИЙ: два одновременных вызова — одно сообщение, второй упирается в журнал", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const results = await Promise.all([
    handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps),
    handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps),
  ]);
  assertEquals(sent.length, 1, "гонка двух вызовов дала человеку два одинаковых сообщения");
  assertEquals(results.map((r) => r.status).sort(), [200, 409]);
});

Deno.test("БЛОКИРУЮЩИЙ: сбой Telegram не съедает повтор — номер освобождается, 502 вызывающему", async () => {
  const store = newStore();
  const { deps, sent, state } = makeDeps(await makeSupabase(store), "telegram 429: too many requests");
  const failed = await handleNotice(asBot({ kind: "container_died", meeting_id: MEETING }), deps);
  assertEquals(failed.status, 502, "недоставленное уведомление отчиталось успехом — человек не узнает ничего");
  const body = await payload(failed);
  assertEquals(body.delivered, false);
  assert(String(body.error).includes("429"), `причина недоставки должна дойти до вызывающего: ${String(body.error)}`);
  assertEquals(store.meeting_notices[0].status, "failed");

  state.fail = undefined;
  const retried = await handleNotice(asBot({ kind: "container_died", meeting_id: MEETING }), deps);
  assertEquals(retried.status, 200, "после сбоя доставки повторить нельзя — человек остался без сигнала");
  assertEquals(sent.length, 1);
  assertEquals(store.meeting_notices[1].status, "sent");
});

Deno.test("журнал недоступен — 503, ничего не отправлено: вслепую не шлём", async () => {
  const store = { ...newStore(), failInsert: true };
  const { deps, sent } = makeDeps(await makeSupabase(store));
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: MEETING }), deps);
  assertEquals(res.status, 503);
  assertEquals(sent.length, 0);
});

// ── Встреча сверяется ─────────────────────────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: встреча чужого воркспейса — 403, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "no_audio", meeting_id: FOREIGN_WS }), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: уведомляемый — не владелец встречи — 403, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "door_denied", meeting_id: FOREIGN_OWNER }), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0, "сообщение о чужой встрече ушло человеку");
});

Deno.test("встречи нет — 404 с подсказкой, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    asBot({ kind: "no_audio", meeting_id: "00000000-0000-4000-8000-000000000000" }),
    deps,
  );
  assertEquals(res.status, 404);
  assertEquals(sent.length, 0);
  assert(String((await payload(res)).error).includes("claim"));
});

// ── Суточные потолки на человека ──────────────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: до-встречные отказы с выдуманными ключами — не больше суточного потолка", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  for (let i = 0; i < MAX_UNBOUND_PER_RECIPIENT_PER_DAY + 5; i++) {
    await handleNotice(asBot({ kind: "no_conference_link", meeting_key: `fresh-${i}` }), deps);
  }
  assertEquals(sent.length, MAX_UNBOUND_PER_RECIPIENT_PER_DAY);
});

Deno.test("БЛОКИРУЮЩИЙ: встреча за встречей — не больше суточного потолка на человека", async () => {
  const store = newStore();
  const ids = Array.from(
    { length: MAX_PER_RECIPIENT_PER_DAY + 5 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  for (const id of ids) store.meetings.push({ id, title: "x", group_id: "alpha", claim_owner: OWNER.telegram_id });
  const { deps, sent } = makeDeps(await makeSupabase(store));
  for (const id of ids) await handleNotice(asBot({ kind: "no_audio", meeting_id: id }), deps);
  assertEquals(sent.length, MAX_PER_RECIPIENT_PER_DAY);
});

// ── Получатель и вход ─────────────────────────────────────────────────────────

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

Deno.test("неизвестный kind — 400, в ответе видно что прислали, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(asBot({ kind: "vsyo_horosho", meeting_id: MEETING }), deps);
  assertEquals(res.status, 400);
  assertEquals(sent.length, 0);
  assert(String((await payload(res)).error).includes("vsyo_horosho"));
});

Deno.test("тело не JSON — 400, а не 500 и не тишина", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request("{не json", { onBehalfOf: OWNER.telegram_id }), deps);
  assertEquals(res.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("не POST — 405 с объяснением", async () => {
  const { deps } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio" }, { method: "GET", onBehalfOf: OWNER.telegram_id }), deps);
  assertEquals(res.status, 405);
});
