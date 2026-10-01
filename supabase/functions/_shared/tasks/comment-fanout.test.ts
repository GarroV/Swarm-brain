// Рассылка о комментарии к задаче — ядро прав (testing.md): уведомление с заголовком и текстом
// комментария, ушедшее тому, кто задачу не видит, — утечка приватной задачи. Модуль общий для
// веба и MCP (issue #521), поэтому проверяем ПОВЕДЕНИЕ: какие строки легли в `notifications`,
// кому ушёл пуш и что записалось в `task_subscriptions`.
// Запуск: deno test -A supabase/functions/_shared/tasks/comment-fanout.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { afterTaskComment, type CommentNotificationInput } from "./comment-fanout.ts";

const ACTOR = 10;
const ASSIGNEE = 20;
const CREATOR = 30;
const OWNER = 40;
const ADMIN_SUB = 50; // админ, подписан явно
const MEMBER_SUB = 60; // не админ, подписан явно
const MUTED_ASSIGNEE = 70;

type Row = Record<string, unknown>;

function makeDb(subs: Row[], admins: number[]) {
  const tables: Record<string, Row[]> = {
    task_subscriptions: [...subs],
    allowed_users: [...subs.map((s) => s.telegram_id), ACTOR].map((id) => ({
      telegram_id: id,
      is_admin: admins.includes(id as number),
    })),
    notifications: [],
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      then: (ok: (x: unknown) => unknown) =>
        Promise.resolve({ data: tables[table].filter((r) => filters.every((f) => f(r))), error: null }).then(ok),
      insert: (rows: Row[]) => {
        tables[table].push(...rows);
        return Promise.resolve({ error: null });
      },
      upsert: (row: Row, opts: { ignoreDuplicates?: boolean }) => {
        const i = tables[table].findIndex((r) => r.task_id === row.task_id && r.telegram_id === row.telegram_id);
        if (i < 0) tables[table].push(row);
        else if (!opts.ignoreDuplicates) tables[table][i] = row;
        return Promise.resolve({ error: null });
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, tables };
}

/** Перехватывает пуши в Telegram: кому ушло и с каким текстом. */
async function withPushSpy(fn: (pushes: Array<{ chat_id: number; text: string }>) => Promise<void>) {
  const pushes: Array<{ chat_id: number; text: string }> = [];
  const realFetch = globalThis.fetch;
  const prevToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  Deno.env.set("TELEGRAM_BOT_TOKEN", "test-token");
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    pushes.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  try {
    await fn(pushes);
  } finally {
    globalThis.fetch = realFetch;
    if (prevToken === undefined) Deno.env.delete("TELEGRAM_BOT_TOKEN");
    else Deno.env.set("TELEGRAM_BOT_TOKEN", prevToken);
  }
}

const input = (isPrivate: boolean): CommentNotificationInput => ({
  task: {
    id: "t1",
    title: "Задача <b>",
    group_id: "cee",
    is_private: isPrivate,
    owner_id: isPrivate ? OWNER : null,
    created_by_telegram_id: CREATOR,
    assignee_telegram_ids: [ASSIGNEE, ACTOR, MUTED_ASSIGNEE],
  },
  commentId: "c1",
  content: "апдейт",
  actorTelegramId: ACTOR,
  actorName: "Агент",
});

const SUBS: Row[] = [
  { task_id: "t1", telegram_id: ADMIN_SUB, state: "subscribed", reason: "comment" },
  { task_id: "t1", telegram_id: MEMBER_SUB, state: "subscribed", reason: "manual" },
  { task_id: "t1", telegram_id: MUTED_ASSIGNEE, state: "muted", reason: "manual" },
];

Deno.test("общая задача: причастные и подписчики, без автора и отписавшегося", async () => {
  const { client, tables } = makeDb(SUBS, [ADMIN_SUB]);
  await withPushSpy(async (pushes) => {
    await afterTaskComment(client, input(false));
    const recipients = tables.notifications.map((n) => n.recipient_telegram_id);
    assertEquals(recipients, [ASSIGNEE, CREATOR, ADMIN_SUB, MEMBER_SUB]);
    assertEquals(pushes.map((p) => p.chat_id), recipients);
    // Пришло по подписке, а не по причастности — с пометкой, откуда взялось.
    const hinted = pushes.filter((p) => p.text.includes("комментировали задачу")).map((p) => p.chat_id);
    assertEquals(hinted, [ADMIN_SUB, MEMBER_SUB]);
    // Заголовок экранируется — пуш уходит с parse_mode HTML.
    assertEquals(pushes[0].text.includes("Задача &lt;b&gt;"), true);
  });
});

Deno.test("приватная задача: уведомление только тем, кто её видит", async () => {
  const { client, tables } = makeDb(SUBS, [ADMIN_SUB]);
  await withPushSpy(async (pushes) => {
    await afterTaskComment(client, input(true));
    // Приватную видит владелец (и админ — оверсайтом, только по явной подписке).
    // Исполнитель, создатель и подписчик-не-админ задачу не видят — им ничего не уходит.
    const recipients = tables.notifications.map((n) => n.recipient_telegram_id);
    assertEquals(recipients, [OWNER, ADMIN_SUB]);
    assertEquals(pushes.map((p) => p.chat_id), recipients);
  });
});

Deno.test("автор подписывается участием, ранее отписавшийся — нет", async () => {
  const { client, tables } = makeDb(SUBS, []);
  await withPushSpy(async () => {
    await afterTaskComment(client, input(false));
    await afterTaskComment(client, { ...input(false), actorTelegramId: MUTED_ASSIGNEE });
  });
  const state = (id: number) => tables.task_subscriptions.find((r) => r.telegram_id === id)?.state;
  assertEquals(state(ACTOR), "subscribed");
  assertEquals(state(MUTED_ASSIGNEE), "muted");
});
