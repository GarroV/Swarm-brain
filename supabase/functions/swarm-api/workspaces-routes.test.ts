import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleAdminRoutes } from "./admin.ts";
import { workspaceStats } from "./workspaces-routes.ts";

const SUPER = 744230399;
const ADMIN_WORLD = 101;
const NOBODY = 303;
const noNames = () => Promise.resolve(new Map<number, string>());

type Call = [method: string, args: unknown[]];
type Query = { table: string; calls: Call[] };
type Reply = { data?: unknown; count?: number | null; error?: unknown };

/** Фейковая база: записывает каждую цепочку запроса; ответ — функция от таблицы и цепочки. */
function makeDb(respond: (q: Query) => Reply = () => ({ data: [] })) {
  const queries: Query[] = [];
  const writes: Array<{ table: string; op: string; row: unknown }> = [];
  const from = (table: string) => {
    const q: Query = { table, calls: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (
      const m of ["select", "eq", "neq", "is", "not", "or", "in", "gte", "contains", "ilike", "order", "limit", "range"]
    ) {
      b[m] = (...args: unknown[]) => (q.calls.push([m, args]), b);
    }
    for (const m of ["insert", "update", "upsert"]) {
      b[m] = (row: unknown) => (q.calls.push([m, [row]]), writes.push({ table, op: m, row }), b);
    }
    const done = () => {
      const r = respond(q);
      return { data: r.data ?? null, count: r.count ?? null, error: r.error ?? null };
    };
    b.maybeSingle = () => Promise.resolve({ ...done(), data: [done().data].flat()[0] ?? null });
    b.single = b.maybeSingle;
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(done()).then(res, rej);
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, queries, writes };
}

async function call(
  db: ReturnType<typeof makeDb>,
  method: string,
  path: string,
  tid: number,
  isAdmin: boolean,
  groupId: string,
  body?: unknown,
) {
  const res = await handleAdminRoutes(
    db.client,
    new Request(`https://x${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    path.split("?")[0], // routePath приходит без строки запроса
    tid,
    isAdmin,
    "*",
    noNames,
    groupId,
    { isMaster: tid === SUPER },
  );
  return res!;
}

const insertsInto = (db: ReturnType<typeof makeDb>, table: string) =>
  db.writes.filter((w) => w.table === table && w.op === "insert");
const updatesOf = (db: ReturnType<typeof makeDb>, table: string) =>
  db.writes.filter((w) => w.table === table && w.op === "update");

// ── создание ────────────────────────────────────────────────────────────────

Deno.test("создание: админ пространства — 403, база не тронута", async () => {
  const db = makeDb();
  const res = await call(db, "POST", "/admin/workspaces", ADMIN_WORLD, true, "world", { name: "X" });
  assertEquals(res.status, 403);
  assertEquals(db.writes.length, 0);
});

Deno.test("создание: пустое и слишком длинное название — 400 с машинным кодом, записи нет", async () => {
  for (
    const [name, code] of [["", "name_required"], ["   ", "name_required"], [undefined, "name_required"], [
      "x".repeat(61),
      "name_too_long",
    ]]
  ) {
    const db = makeDb();
    const res = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", { name });
    assertEquals(res.status, 400, String(name));
    assertEquals((await res.json()).code, code);
    assertEquals(insertsInto(db, "workspaces").length, 0);
  }
});

Deno.test("создание: слаг генерируется и не зависит от названия; id из тела игнорируется", async () => {
  const db = makeDb();
  const res = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", {
    name: "  World  ",
    id: "hacked",
    countries: ["TR", "Грузия"],
  });
  assertEquals(res.status, 201);
  const out = await res.json();
  assert(/^ws-[a-z2-7]{8}$/.test(out.id), out.id);
  assertEquals(out.name, "World");
  assertEquals(out.allowed_markets, ["TR", "GE"]);
  const row = insertsInto(db, "workspaces")[0].row as Record<string, unknown>;
  assertEquals(row.id, out.id);
  assertEquals(row.name, "World");
});

Deno.test("создание: названный админ уже в другом пространстве — 409 и пространство не создаётся", async () => {
  const db = makeDb((q) => q.table === "allowed_users" ? { data: [{ group_id: "cee" }] } : { data: [] });
  const res = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", {
    name: "World",
    admins: ["indira@dodobrands.io"],
  });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "admin_in_other_workspace");
  assertEquals(insertsInto(db, "workspaces").length, 0);
});

Deno.test("создание: новый человек из списка админов получает флаг is_admin в новом пространстве", async () => {
  const db = makeDb((q) => (q.table === "workspaces" ? { data: [{ id: "x" }] } : { data: null }));
  const res = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", {
    name: "World",
    admins: ["new.person@dodobrands.io"],
  });
  assertEquals(res.status, 201);
  const out = await res.json();
  const flag = updatesOf(db, "allowed_users").find((w) => (w.row as Record<string, unknown>).is_admin === true);
  assert(flag, "флаг is_admin не записан");
  const inv = insertsInto(db, "allowed_users")[0].row as Record<string, unknown>;
  assertEquals(inv.group_id, out.id);
  assertEquals(inv.email, "new.person@dodobrands.io");
});

Deno.test("создание: мусор в списке админов — 400 до записи", async () => {
  const db = makeDb();
  const res = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", { name: "World", admins: [123.5, {}] });
  assertEquals(res.status, 400);
  assertEquals(insertsInto(db, "workspaces").length, 0);
});

// ── переименование ──────────────────────────────────────────────────────────

Deno.test("переименование: слишком длинное и пустое название — 400, обновления нет (раньше писалось что угодно)", async () => {
  for (const name of ["x".repeat(61), "   ", ""]) {
    const db = makeDb();
    const res = await call(db, "PATCH", "/admin/workspaces/world", ADMIN_WORLD, true, "world", { name });
    assertEquals(res.status, 400, JSON.stringify(name));
    assertEquals(updatesOf(db, "workspaces").length, 0);
  }
});

Deno.test("переименование: название обрезается; чужое пространство для админа — 404; мастеру доступно любое", async () => {
  const own = makeDb();
  assertEquals(
    (await call(own, "PATCH", "/admin/workspaces/world", ADMIN_WORLD, true, "world", { name: "  World 2 " })).status,
    200,
  );
  assertEquals((updatesOf(own, "workspaces")[0].row as Record<string, unknown>).name, "World 2");

  const foreign = makeDb();
  assertEquals(
    (await call(foreign, "PATCH", "/admin/workspaces/cee", ADMIN_WORLD, true, "world", { name: "Mine now" })).status,
    404,
  );
  assertEquals(updatesOf(foreign, "workspaces").length, 0);

  const master = makeDb();
  assertEquals((await call(master, "PATCH", "/admin/workspaces/cee", SUPER, true, "cee", { name: "CEE" })).status, 200);
});

// ── сводка ──────────────────────────────────────────────────────────────────

function statsDb() {
  return makeDb((q) => {
    const has = (m: string, ...a: unknown[]) =>
      q.calls.some(([n, args]) => n === m && a.every((v, i) => JSON.stringify(args[i]) === JSON.stringify(v)));
    const head = q.calls.some(([n, a]) => n === "select" && (a[1] as { head?: boolean } | undefined)?.head);
    switch (q.table) {
      case "workspaces":
        return { data: [{ id: "world", name: "World" }] };
      case "allowed_users":
        return {
          data: [
            { telegram_id: 1, is_admin: true },
            { telegram_id: 2, is_admin: false },
            { telegram_id: 3, is_admin: false },
            { telegram_id: null, is_admin: false },
          ],
        };
      case "presence":
        return { data: [{ telegram_id: 1 }, { telegram_id: 99 }] }; // 99 — не из пространства
      case "task_history":
        return { data: [{ changed_by_telegram_id: 2 }, { changed_by_telegram_id: 1 }] };
      case "entries":
        if (!head) return { data: [{ owner_id: 3 }, { owner_id: 3 }] };
        if (has("contains")) return { count: 4 };
        return has("eq", "entry_type", "meeting") ? { count: 7 } : { count: 11 };
      case "tasks":
        return { count: 5 };
      case "model_usage":
        return { data: [{ cost_usd: 1.005 }, { cost_usd: 2.5 }, { cost_usd: null }] };
      case "service_agents":
        return { data: [{ is_active: true, token_hash: "h", last_seen_at: "2026-11-05T10:00:00Z" }] };
      default:
        return { data: [] };
    }
  });
}

Deno.test("сводка: считает только числа по пространству; активные — только его люди, без дублей", async () => {
  const db = statsDb();
  const s = await workspaceStats(db.client, "world", new Date("2026-11-05T12:00:00Z"));
  assertEquals(s.people, { total: 4, pending: 1, admins: 1, active: 3 }); // 1 (presence+история), 2 (история), 3 (записи); 99 отсечён
  assertEquals(s.meetings, { home: 7, shared_in: 4 });
  assertEquals(s.entries, 11);
  assertEquals(s.tasks_open, 5);
  assertEquals(s.model_spend_usd, 3.51);
  assertEquals(s.recorder_bot, { configured: true, active: true, last_seen_at: "2026-11-05T10:00:00Z" });
  assertEquals(s.window_days, 30);
});

Deno.test("сводка: каждый запрос ограничен пространством", async () => {
  const db = statsDb();
  await workspaceStats(db.client, "world", new Date("2026-11-05T12:00:00Z"));
  for (const q of db.queries) {
    const scoped = q.calls.some(([m, a]) =>
      (m === "eq" && a[0] === "group_id" && a[1] === "world") || (m === "contains" && a[0] === "visible_group_ids")
    );
    assert(scoped, `запрос к ${q.table} без ограничения пространством`);
  }
});

Deno.test("сводка по маршруту: мастер видит любое, админ — своё, чужое — 404, не админ — 403", async () => {
  const get = (tid: number, isAdmin: boolean, group: string, ws: string) =>
    call(statsDb(), "GET", `/admin/workspaces/${ws}/stats`, tid, isAdmin, group);
  const asMaster = await get(SUPER, true, "cee", "world");
  assertEquals(asMaster.status, 200);
  const body = await asMaster.json();
  assertEquals(body.name, "World");
  assertEquals(body.people.total, 4);
  assertEquals((await get(ADMIN_WORLD, true, "world", "world")).status, 200);
  assertEquals((await get(ADMIN_WORLD, true, "world", "cee")).status, 404);
  assertEquals((await get(NOBODY, false, "world", "world")).status, 403);
});

Deno.test("сводка: несуществующее пространство для мастера — 404; ошибка базы — 500 без подробностей", async () => {
  const none = makeDb(() => ({ data: [] }));
  assertEquals((await call(none, "GET", "/admin/workspaces/nope/stats", SUPER, true, "cee")).status, 404);

  const broken = makeDb((q) =>
    q.table === "workspaces"
      ? { data: [{ id: "world", name: "World" }] }
      : { error: { message: "secret table detail" } }
  );
  const res = await call(broken, "GET", "/admin/workspaces/world/stats", SUPER, true, "cee");
  assertEquals(res.status, 500);
  assert(!(await res.text()).includes("secret table detail"));
});

// ── очередь вычитки и рассылка ──────────────────────────────────────────────

Deno.test("очередь вычитки: админ с чужим пространством — 404; мастер выбирает любое", async () => {
  const get = (tid: number, group: string, ws: string) =>
    call(makeDb(), "GET", `/admin/review-counts?workspace=${ws}`, tid, true, group);
  assertEquals((await get(ADMIN_WORLD, "world", "cee")).status, 404);
  assertEquals((await get(ADMIN_WORLD, "world", "world")).status, 200);
  assertEquals((await get(SUPER, "cee", "world")).status, 200);
});

Deno.test("рассылка: админ не может адресовать чужое пространство или «всем»", async () => {
  Deno.env.set("TELEGRAM_BOT_TOKEN", "t");
  for (const workspace of ["cee", "all"]) {
    // получателей нет: проверяем границы выборки, а не отправку (в Telegram тест не ходит)
    const db = makeDb((q) => q.table === "workspaces" ? { data: [{ id: workspace }] } : { data: [] });
    const res = await call(db, "POST", "/admin/broadcast", ADMIN_WORLD, true, "world", { text: "hi", workspace });
    // «all» для админа сводится к его пространству, чужой id — 404
    if (workspace === "cee") assertEquals(res.status, 404);
    const scoped = db.queries.filter((q) => q.table === "allowed_users");
    for (const q of scoped) {
      assert(
        q.calls.some(([m, a]) => m === "eq" && a[0] === "group_id" && a[1] === "world"),
        "рассылка админа вышла за его пространство",
      );
    }
  }
});

Deno.test("рассылка: мастер с несуществующим пространством — 404, никому не уходит", async () => {
  Deno.env.set("TELEGRAM_BOT_TOKEN", "t");
  const db = makeDb(() => ({ data: [] }));
  const res = await call(db, "POST", "/admin/broadcast", SUPER, true, "cee", { text: "hi", workspace: "nope" });
  assertEquals(res.status, 404);
  assertEquals(db.queries.filter((q) => q.table === "allowed_users").length, 0);
});
