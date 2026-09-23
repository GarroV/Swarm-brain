// Ручка meeting-notice: единственная поверхность блока notices.
//
// Здесь проверяется не «сообщение красивое», а три вещи, каждая из которых уже была источником
// молчаливого сбоя в этом продукте:
//   • получатель НЕ приходит из тела запроса — иначе токен бота становится рассылкой по людям;
//   • отказ доставки (Telegram ответил не 200) виден вызывающему, а не проглатывается 200-кой;
//   • отказ разбора и отказ авторизации объясняют себя текстом, а не пустым кодом.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ON_BEHALF_OF_HEADER, sha256Hex } from "../_shared/agent-auth.ts";
import { handleNotice } from "./handle.ts";

const BOT_TOKEN = "scriba-container-secret";
const HUMAN_TOKEN = "recorder-token-of-a-real-person";
const OWNER = { telegram_id: 111, group_id: "alpha" };

type Row = Record<string, unknown> | null;

/** Поддельная база: различает «найди по токену» и «найди человека по telegram_id». */
async function makeSupabase(): Promise<SupabaseClient> {
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
          let data: Row = null;
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
  const deps = {
    supabase,
    sendTelegram: (chatId: number, text: string): Promise<void> => {
      if (fail !== undefined) return Promise.reject(new Error(fail));
      sent.push({ chatId, text });
      return Promise.resolve();
    },
  };
  return { deps, sent };
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

async function payload(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

Deno.test("бот у двери: уведомление уходит человеку, ответ ведёт бота дальше", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    request({ kind: "door_waiting", attempt: 1, title: "Weekly sync" }, { onBehalfOf: OWNER.telegram_id }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await payload(res), { ok: true, delivered: true, should_leave: false, next_reminder_in_s: 180 });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].chatId, OWNER.telegram_id);
  assert(sent[0].text.includes("Weekly sync"), sent[0].text);
});

Deno.test("повтор — последний: ответ велит уходить, следующего напоминания нет", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    request({ kind: "door_waiting", attempt: 2, title: "Weekly sync" }, { onBehalfOf: OWNER.telegram_id }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await payload(res), { ok: true, delivered: true, should_leave: true, next_reminder_in_s: null });
  assertEquals(sent.length, 1);
});

Deno.test("БЛОКИРУЮЩИЙ: третье уведомление о двери не отправляется вообще", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    request({ kind: "door_waiting", attempt: 3, title: "Weekly sync" }, { onBehalfOf: OWNER.telegram_id }),
    deps,
  );
  assertEquals(res.status, 409);
  assertEquals(sent.length, 0, "третье уведомление ушло человеку — потолок повтора не держит");
  const body = await payload(res);
  assertEquals(body.should_leave, true, "боту не сказали уйти — он останется висеть у двери");
});

Deno.test("БЛОКИРУЮЩИЙ: получатель не берётся из тела запроса", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(
    request(
      { kind: "no_audio", title: "Weekly sync", telegram_id: 999, chat_id: 999, owner_id: 999 },
      { onBehalfOf: OWNER.telegram_id },
    ),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sent[0].chatId, OWNER.telegram_id, "уведомление ушло по id из тела запроса — это рассылка чужим");
});

Deno.test("личный токен человека тоже открывает дверь — без X-On-Behalf-Of", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_conference_link" }, { token: HUMAN_TOKEN }), deps);
  assertEquals(res.status, 200);
  assertEquals(sent[0].chatId, OWNER.telegram_id);
});

Deno.test("чужой токен — 401 с внятным текстом, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio" }, { token: "who-is-this" }), deps);
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
  const body = await payload(res);
  assertEquals(body.ok, false);
  assert(String(body.error).length > 0, "401 без объяснения — тот же молчаливый отказ");
});

Deno.test("токен бота без X-On-Behalf-Of прав не даёт", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "no_audio" }), deps);
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0);
});

Deno.test("неизвестный kind — 400, в ответе видно что прислали, ничего не отправлено", async () => {
  const { deps, sent } = makeDeps(await makeSupabase());
  const res = await handleNotice(request({ kind: "vsyo_horosho" }, { onBehalfOf: OWNER.telegram_id }), deps);
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

Deno.test("БЛОКИРУЮЩИЙ: Telegram не принял сообщение — вызывающий получает 502, а не 200", async () => {
  const { deps } = makeDeps(await makeSupabase(), "telegram 429: too many requests");
  const res = await handleNotice(
    request({ kind: "container_died", title: "Weekly sync" }, { onBehalfOf: OWNER.telegram_id }),
    deps,
  );
  assertEquals(res.status, 502, "недоставленное уведомление отчиталось успехом — человек не узнает ничего");
  const body = await payload(res);
  assertEquals(body.ok, false);
  assertEquals(body.delivered, false);
  assert(String(body.error).includes("429"), `причина недоставки должна дойти до вызывающего: ${String(body.error)}`);
});
