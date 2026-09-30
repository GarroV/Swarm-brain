// Границы админских маршрутов: объём воркспейса, аккаунт суперадмина, заметность смены почты.
// Ядро прав доступа — тесты до кода (testing.md). Мок — маленькая память postgrest: цепочка
// `.from(t).select/update/…eq/is/ilike` фильтрует фикстуры, чтобы проверять ПОВЕДЕНИЕ
// (что ушло в базу и что вернулось), а не порядок вызовов.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleAdminRoutes } from "./admin.ts";
import { announceEmailChange, type EmailChangeEvent, emailChangeNoticeText } from "./admin-scope.ts";

const SUPER = 744230399;
const ADMIN_CEE = 1001; // флаг is_admin, воркспейс cee
const MEMBER_CEE = 2001;
const MEMBER_OTHER = 3001; // чужой воркспейс
const PENDING_OTHER = "stranger"; // ожидающее приглашение в чужом воркспейсе

type Row = Record<string, unknown>;
type Write = { table: string; op: string; values?: unknown; filters: Array<[string, string, unknown]> };

function fixtures(): Record<string, Row[]> {
  return {
    allowed_users: [
      { id: 1, telegram_id: SUPER, group_id: "cee", email: "owner@x.io", username: "owner", is_admin: true },
      { id: 2, telegram_id: ADMIN_CEE, group_id: "cee", email: "adm@x.io", username: "adm", is_admin: true },
      { id: 3, telegram_id: MEMBER_CEE, group_id: "cee", email: "m@x.io", username: "m", is_admin: false },
      { id: 4, telegram_id: MEMBER_OTHER, group_id: "other", email: "o@x.io", username: "o", is_admin: false },
      { id: 5, telegram_id: null, group_id: "other", email: null, username: PENDING_OTHER, is_admin: false },
    ],
    workspaces: [{ id: "cee", name: "CEE", allowed_markets: null }, {
      id: "other",
      name: "Other",
      allowed_markets: null,
    }],
    user_profiles: [],
  };
}

function makeDb() {
  const db = fixtures();
  const writes: Write[] = [];
  const reads: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];

  function chain(table: string) {
    let op = "select";
    let values: unknown;
    const filters: Array<[string, string, unknown]> = [];
    const match = (r: Row) =>
      filters.every(([kind, col, v]) => {
        if (kind === "eq") return r[col] === v;
        if (kind === "is") return r[col] === v;
        if (kind === "ilike") return String(r[col] ?? "").toLowerCase() === String(v).toLowerCase();
        if (kind === "in") return (v as unknown[]).includes(r[col]);
        if (kind === "not") return r[col] !== null;
        return true;
      });
    const run = () => {
      const rows = (db[table] ?? []).filter(match);
      if (op === "select") {
        reads.push({ table, filters: [...filters] });
        return rows;
      }
      writes.push({ table, op, values, filters: [...filters] });
      if (op === "update") return rows.map((r) => ({ ...r, ...(values as Row) }));
      if (op === "delete") return rows;
      return [values];
    };
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = () => self();
    for (const w of ["update", "upsert", "insert", "delete"]) {
      b[w] = (v?: unknown) => {
        op = w;
        values = v;
        return self();
      };
    }
    b.eq = (c: string, v: unknown) => (filters.push(["eq", c, v]), self());
    b.is = (c: string, v: unknown) => (filters.push(["is", c, v]), self());
    b.ilike = (c: string, v: unknown) => (filters.push(["ilike", c, v]), self());
    b.in = (c: string, v: unknown) => (filters.push(["in", c, v]), self());
    b.not = (c: string) => (filters.push(["not", c, null]), self());
    b.limit = self;
    b.order = self;
    b.or = self;
    b.maybeSingle = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res);
    return b;
  }

  const client = { from: (t: string) => chain(t) } as unknown as SupabaseClient;
  return { client, writes, reads };
}

const names = () => Promise.resolve(new Map<number, string>([[ADMIN_CEE, "Adm"], [SUPER, "Owner"]]));

function captureAnnounce() {
  const events: EmailChangeEvent[] = [];
  return { events, announce: (ev: EmailChangeEvent) => (events.push(ev), Promise.resolve()) };
}

function call(
  db: ReturnType<typeof makeDb>,
  actor: number,
  method: string,
  path: string,
  body?: unknown,
  announce = captureAnnounce(),
) {
  const req = new Request("https://x/admin", {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return handleAdminRoutes(db.client, req, path, actor, true, "*", names, "cee", { announce: announce.announce });
}

// ── PATCH /admin/users/:ref ──────────────────────────────────────────────────

Deno.test("админ правит почту участника СВОЕГО воркспейса → 200, человеку уходит уведомление", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, ADMIN_CEE, "PATCH", `/admin/users/${MEMBER_CEE}`, { email: "New@X.io" }, a);
  assertEquals(res!.status, 200);
  const au = db.writes.find((w) => w.table === "allowed_users" && w.op === "update");
  assertEquals(au?.values, { email: "new@x.io" });
  assertEquals(a.events.length, 1);
  assertEquals(a.events[0].targetTelegramId, MEMBER_CEE);
  assertEquals(a.events[0].oldEmail, "m@x.io");
  assertEquals(a.events[0].newEmail, "new@x.io");
  assertEquals(a.events[0].actorName, "Adm");
});

Deno.test("админ правит участника ЧУЖОГО воркспейса → 404, в базу ничего не пишется", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, ADMIN_CEE, "PATCH", `/admin/users/${MEMBER_OTHER}`, { email: "take@x.io" }, a);
  assertEquals(res!.status, 404);
  assertEquals(db.writes, []);
  assertEquals(a.events, []);
});

Deno.test("админ меняет почту суперадмина → 403, в базу ничего не пишется", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "PATCH", `/admin/users/${SUPER}`, { email: "take@x.io" });
  assertEquals(res!.status, 403);
  assertEquals(db.writes, []);
});

Deno.test("суперадмин правит почту участника любого воркспейса → 200 с уведомлением", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, SUPER, "PATCH", `/admin/users/${MEMBER_OTHER}`, { email: "o2@x.io" }, a);
  assertEquals(res!.status, 200);
  assert(db.writes.some((w) => w.table === "allowed_users" && w.op === "update"));
  assertEquals(a.events.length, 1);
});

Deno.test("суперадмин меняет СВОЮ почту → 200, себе не уведомляем", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, SUPER, "PATCH", `/admin/users/${SUPER}`, { email: "owner2@x.io" }, a);
  assertEquals(res!.status, 200);
  assertEquals(a.events, []);
});

Deno.test("правка без смены почты — уведомления нет", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, ADMIN_CEE, "PATCH", `/admin/users/${MEMBER_CEE}`, { role: "BD", email: "M@x.io" }, a);
  assertEquals(res!.status, 200);
  assertEquals(a.events, []);
});

Deno.test("админ правит ожидающее приглашение чужого воркспейса → 404, запрос ограничен своим group_id", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "PATCH", `/admin/users/${PENDING_OTHER}`, { email: "p@x.io" });
  assertEquals(res!.status, 404);
  const upd = db.writes.filter((w) => w.op === "update");
  assert(upd.every((w) => w.filters.some(([k, c, v]) => k === "eq" && c === "group_id" && v === "cee")));
});

// ── Воркспейсы ───────────────────────────────────────────────────────────────

Deno.test("админ видит в списке воркспейсов только свой", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "GET", "/admin/workspaces");
  assertEquals(res!.status, 200);
  const list = await res!.json() as Array<{ id: string }>;
  assertEquals(list.map((w) => w.id), ["cee"]);
});

Deno.test("суперадмин видит все воркспейсы", async () => {
  const db = makeDb();
  const res = await call(db, SUPER, "GET", "/admin/workspaces");
  const list = await res!.json() as Array<{ id: string }>;
  assertEquals(list.map((w) => w.id).sort(), ["cee", "other"]);
});

Deno.test("админ читает участников чужого воркспейса → 404; своего → 200", async () => {
  const db = makeDb();
  assertEquals((await call(db, ADMIN_CEE, "GET", "/admin/workspaces/other/users"))!.status, 404);
  assertEquals((await call(db, ADMIN_CEE, "GET", "/admin/workspaces/cee/users"))!.status, 200);
});

Deno.test("админ правит чужой воркспейс → 404, свой → 200", async () => {
  const db = makeDb();
  assertEquals((await call(db, ADMIN_CEE, "PATCH", "/admin/workspaces/other", { name: "X" }))!.status, 404);
  assertEquals(db.writes, []);
  assertEquals((await call(db, ADMIN_CEE, "PATCH", "/admin/workspaces/cee", { name: "CEE2" }))!.status, 200);
});

Deno.test("создать воркспейс может только суперадмин", async () => {
  const db = makeDb();
  assertEquals((await call(db, ADMIN_CEE, "POST", "/admin/workspaces", { id: "new", name: "New" }))!.status, 403);
  assertEquals(db.writes, []);
  assertEquals((await call(db, SUPER, "POST", "/admin/workspaces", { id: "new", name: "New" }))!.status, 201);
});

// ── Участники воркспейса ─────────────────────────────────────────────────────

Deno.test("админ удаляет в чужом воркспейсе → 404, в базу ничего не пишется", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "DELETE", `/admin/workspaces/other/users/${MEMBER_OTHER}`);
  assertEquals(res!.status, 404);
  assertEquals(db.writes, []);
});

Deno.test("админ добавляет в чужой воркспейс → 404", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "POST", "/admin/workspaces/other/users", { username: "newbie" });
  assertEquals(res!.status, 404);
  assertEquals(db.writes, []);
});

Deno.test("админ перетягивает к себе участника чужого воркспейса → 403", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "POST", "/admin/workspaces/cee/users", { telegram_id: MEMBER_OTHER });
  assertEquals(res!.status, 403);
  assertEquals(db.writes, []);
});

Deno.test("админ через добавление меняет почту суперадмина → 403", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "POST", "/admin/workspaces/cee/users", {
    telegram_id: SUPER,
    email: "take@x.io",
  });
  assertEquals(res!.status, 403);
  assertEquals(db.writes, []);
});

Deno.test("админ добавляет нового человека в свой воркспейс → 200", async () => {
  const db = makeDb();
  const res = await call(db, ADMIN_CEE, "POST", "/admin/workspaces/cee/users", { username: "newbie" });
  assertEquals(res!.status, 200);
  assert(db.writes.some((w) => w.table === "allowed_users" && w.op === "insert"));
});

Deno.test("добавление, меняющее почту участника своего воркспейса, заметно человеку", async () => {
  const db = makeDb();
  const a = captureAnnounce();
  const res = await call(db, ADMIN_CEE, "POST", "/admin/workspaces/cee/users", {
    telegram_id: MEMBER_CEE,
    email: "m2@x.io",
  }, a);
  assertEquals(res!.status, 200);
  assertEquals(a.events.length, 1);
  assertEquals(a.events[0].oldEmail, "m@x.io");
});

Deno.test("суперадмин переносит участника из чужого воркспейса → 200", async () => {
  const db = makeDb();
  const res = await call(db, SUPER, "POST", "/admin/workspaces/cee/users", { telegram_id: MEMBER_OTHER });
  assertEquals(res!.status, 200);
});

// ── Рассылка ─────────────────────────────────────────────────────────────────

Deno.test("рассылка админа уходит только его воркспейсу", async () => {
  const db = makeDb();
  const prevToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const realFetch = globalThis.fetch;
  const sentTo: number[] = [];
  Deno.env.set("TELEGRAM_BOT_TOKEN", "t");
  globalThis.fetch = ((_u: string, init?: RequestInit) => {
    sentTo.push(JSON.parse(String(init?.body)).chat_id);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const res = await call(db, ADMIN_CEE, "POST", "/admin/broadcast", { text: "hi" });
    assertEquals(res!.status, 200);
    assertEquals(sentTo.sort(), [ADMIN_CEE, MEMBER_CEE].sort());
  } finally {
    globalThis.fetch = realFetch;
    if (prevToken == null) Deno.env.delete("TELEGRAM_BOT_TOKEN");
    else Deno.env.set("TELEGRAM_BOT_TOKEN", prevToken);
  }
});

// ── Нет воркспейса у админа — закрыто по умолчанию ───────────────────────────

Deno.test("админ без переданного воркспейса ничего не видит (закрыто по умолчанию)", async () => {
  const db = makeDb();
  const req = new Request("https://x/admin", { method: "GET" });
  const res = await handleAdminRoutes(db.client, req, "/admin/workspaces/cee/users", ADMIN_CEE, true, "*", names);
  assertEquals(res!.status, 404);
});

// ── Уведомление ──────────────────────────────────────────────────────────────

Deno.test("текст уведомления двуязычный и называет обе почты", () => {
  const t = emailChangeNoticeText("Adm", "a@x.io", "b@x.io");
  assert(t.includes("changed the email"));
  assert(t.includes("изменил почту"));
  assert(t.includes("a@x.io") && t.includes("b@x.io"));
});

Deno.test("уведомление: синтетический id и ожидающее приглашение в Telegram не шлются", async () => {
  const sent: number[] = [];
  const send = (id: number) => (sent.push(id), Promise.resolve(true));
  const base = {
    actor: { telegramId: ADMIN_CEE, groupId: "cee" },
    targetGroupId: "cee",
    oldEmail: "a@x.io",
    newEmail: "b@x.io",
    actorName: "Adm",
  };
  await announceEmailChange({ ...base, targetTelegramId: -5 }, send);
  await announceEmailChange({ ...base, targetTelegramId: null }, send);
  await announceEmailChange({ ...base, targetTelegramId: MEMBER_CEE }, send);
  assertEquals(sent, [MEMBER_CEE]);
});

Deno.test("уведомление: сбой отправки не роняет вызов", async () => {
  await announceEmailChange({
    actor: { telegramId: ADMIN_CEE, groupId: "cee" },
    targetTelegramId: MEMBER_CEE,
    targetGroupId: "cee",
    oldEmail: null,
    newEmail: "b@x.io",
    actorName: "Adm",
  }, () => Promise.reject(new Error("down")));
});
