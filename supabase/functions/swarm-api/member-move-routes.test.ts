// Маршруты переезда человека: кто может, что уходит в базу, как отказы базы становятся HTTP.
// Сам переезд — функция базы, её правила проверяет _shared/users/member-move.db.test.ts.
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleAdminRoutes } from "./admin.ts";
import { moveErrorStatus, parseExpected, parseTelegramId } from "./member-move-routes.ts";

const OWNER = 744230399;
const MASTER = 555;
const ADMIN_CEE = 101;
const PERSON = 4242;

type RpcCall = { fn: string; args: Record<string, unknown> };

const OK_RESULT = {
  person: { telegram_id: PERSON, email: "p@x.io" },
  from: "cee",
  to: "world",
  counts: { tasks: 2, entries: 1 },
  tasks_mixed: [{ id: "t1", title: "mixed" }],
  tasks_detached: [],
  projects: [],
  tokens: { claude: true, chatgpt: false, oauth: 1, recorder: true },
  conflicts: [],
  can_execute: true,
  moved: false,
};

function fakeDb(
  answer: (args: Record<string, unknown>) => Record<string, unknown>,
  account: { id: string; telegram_id: number | null } | null = null,
) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: answer(args), error: null });
    },
    from(table: string) {
      if (table === "allowed_users") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: () => Promise.resolve({ data: account?.id === id ? account : null, error: null }),
            }),
          }),
        };
      }
      if (table !== "workspaces") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: () =>
            Promise.resolve({ data: [{ id: "cee", name: "IMF BD" }, { id: "world", name: "World" }], error: null }),
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

const names = (ids: number[]) => Promise.resolve(new Map(ids.map((i) => [i, `Name ${i}`])));

async function call(
  db: ReturnType<typeof fakeDb>,
  method: string,
  path: string,
  actor: number,
  { isMaster = false, body }: { isMaster?: boolean; body?: unknown } = {},
) {
  const res = await handleAdminRoutes(
    db.client,
    new Request(`https://x${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    new URL(`https://x${path}`).pathname,
    actor,
    true,
    "*",
    names,
    "cee",
    { isMaster },
  );
  return { status: res!.status, body: await res!.json() };
}

Deno.test("move-preview: мастер-админ получает форму контракта с именами, пробный прогон", async () => {
  const db = fakeDb(() => OK_RESULT);
  const r = await call(db, "GET", `/admin/members/${PERSON}/move-preview?to=world`, MASTER, { isMaster: true });
  assertEquals(r.status, 200);
  assertEquals(r.body.person, { telegram_id: PERSON, name: `Name ${PERSON}`, email: "p@x.io" });
  assertEquals([r.body.from, r.body.to], [{ id: "cee", name: "IMF BD" }, { id: "world", name: "World" }]);
  assertEquals(r.body.tokens, OK_RESULT.tokens);
  assertEquals(r.body.can_execute, true);
  assertEquals("moved" in r.body, false);
  assertEquals(db.rpcCalls, [{
    fn: "move_member_to_workspace",
    args: { p_telegram_id: PERSON, p_to: "world", p_actor: MASTER, p_dry_run: true, p_expected: null },
  }]);
});

Deno.test("переезд: не мастер — 403, база не вызывается", async () => {
  const db = fakeDb(() => OK_RESULT);
  const pre = await call(db, "GET", `/admin/members/${PERSON}/move-preview?to=world`, ADMIN_CEE);
  const mv = await call(db, "POST", `/admin/members/${PERSON}/move`, ADMIN_CEE, {
    body: { to: "world", expected: { tasks: 2, entries: 1 } },
  });
  assertEquals([pre.status, mv.status], [403, 403]);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("переезд: аккаунт владельца переводит только он сам", async () => {
  const db = fakeDb(() => OK_RESULT);
  const other = await call(db, "GET", `/admin/members/${OWNER}/move-preview?to=world`, MASTER, { isMaster: true });
  assertEquals([other.status, other.body.code], [403, "owner_only"]);
  assertEquals(db.rpcCalls.length, 0);
  const self = await call(db, "GET", `/admin/members/${OWNER}/move-preview?to=world`, OWNER);
  assertEquals(self.status, 200);
});

Deno.test("переезд: выполнение передаёт показанные числа в базу и возвращает moved", async () => {
  const db = fakeDb(() => ({ ...OK_RESULT, moved: true }));
  const r = await call(db, "POST", `/admin/members/${PERSON}/move`, MASTER, {
    isMaster: true,
    body: { to: "world", expected: { tasks: 2, entries: 1 } },
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.moved, true);
  assertEquals(db.rpcCalls[0].args, {
    p_telegram_id: PERSON,
    p_to: "world",
    p_actor: MASTER,
    p_dry_run: false,
    p_expected: { tasks: 2, entries: 1 },
  });
});

Deno.test("переезд: без expected или с кривым — 400, база не вызывается", async () => {
  const db = fakeDb(() => OK_RESULT);
  for (const body of [{ to: "world" }, { to: "world", expected: { tasks: -1, entries: 0 } }, { expected: {} }]) {
    const r = await call(db, "POST", `/admin/members/${PERSON}/move`, MASTER, { isMaster: true, body });
    assertEquals(r.status, 400, JSON.stringify(body));
  }
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("переезд: отказы базы → 404/409 с машинной причиной и подробностями", async () => {
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ error: "person_not_found" }, 404, "person_not_found"],
    [{ error: "workspace_not_found" }, 404, "workspace_not_found"],
    [{ error: "same_workspace" }, 409, "same_workspace"],
    [{ ...OK_RESULT, error: "conflicts", conflicts: ["people_email_taken:p@x.io"] }, 409, "conflicts"],
    [{ ...OK_RESULT, error: "expected_mismatch" }, 409, "expected_mismatch"],
  ];
  for (const [answer, status, code] of cases) {
    const db = fakeDb(() => answer);
    const r = await call(db, "POST", `/admin/members/${PERSON}/move`, MASTER, {
      isMaster: true,
      body: { to: "world", expected: { tasks: 2, entries: 1 } },
    });
    assertEquals([r.status, r.body.code], [status, code]);
    if (code === "conflicts") assertEquals(r.body.conflicts, ["people_email_taken:p@x.io"]);
    if (code === "expected_mismatch") assertEquals(r.body.counts, OK_RESULT.counts);
  }
});

Deno.test("переезд: id не число — 404 мастеру, 403 остальным", async () => {
  const db = fakeDb(() => OK_RESULT);
  const master = await call(db, "GET", `/admin/members/abc/move-preview?to=world`, MASTER, { isMaster: true });
  const admin = await call(db, "GET", `/admin/members/abc/move-preview?to=world`, ADMIN_CEE);
  assertEquals([master.status, admin.status], [404, 403]);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("разбор: id, expected и отказы базы", () => {
  assertEquals(parseTelegramId("123"), 123);
  assertEquals(parseTelegramId("-5"), -5);
  assertEquals([parseTelegramId("0"), parseTelegramId("1.5"), parseTelegramId("99999999999999999999")], [
    null,
    null,
    null,
  ]);
  assertEquals(parseExpected({ tasks: 0, entries: 3 }), { tasks: 0, entries: 3 });
  assertEquals([parseExpected({ tasks: 1.5, entries: 0 }), parseExpected(null), parseExpected([1])], [
    null,
    null,
    null,
  ]);
  assertEquals(moveErrorStatus(undefined), null);
  assertEquals(moveErrorStatus("something_new")?.status, 500);
});

Deno.test("переезд: приглашение без входа адресуется account ID, Telegram ID остаётся null", async () => {
  const account = { id: "1014", telegram_id: null };
  const db = fakeDb(
    () => ({ ...OK_RESULT, person: { account_id: account.id, telegram_id: null, email: "pending@x.io" } }),
    account,
  );
  const r = await call(db, "GET", `/admin/member-accounts/${account.id}/move-preview?to=world`, MASTER, {
    isMaster: true,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.person, { account_id: account.id, telegram_id: null, name: null, email: "pending@x.io" });
  assertEquals(db.rpcCalls, [{
    fn: "move_member_account_to_workspace",
    args: { p_account_id: account.id, p_to: "world", p_actor: MASTER, p_dry_run: true, p_expected: null },
  }]);
});

Deno.test("переезд: account ID выполняет тот же подтверждённый перенос для приглашения", async () => {
  const account = { id: "1014", telegram_id: null };
  const db = fakeDb(
    () => ({ ...OK_RESULT, person: { account_id: account.id, telegram_id: null, email: "pending@x.io" }, moved: true }),
    account,
  );
  const r = await call(db, "POST", `/admin/member-accounts/${account.id}/move`, MASTER, {
    isMaster: true,
    body: { to: "world", expected: { tasks: 2, entries: 1 } },
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.moved, true);
  assertEquals(db.rpcCalls[0], {
    fn: "move_member_account_to_workspace",
    args: {
      p_account_id: account.id,
      p_to: "world",
      p_actor: MASTER,
      p_dry_run: false,
      p_expected: { tasks: 2, entries: 1 },
    },
  });
});
