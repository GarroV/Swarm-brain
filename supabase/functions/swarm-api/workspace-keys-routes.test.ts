import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeFakeDb } from "../_shared/workspace-keys.fake.ts";
import { resetKeyCache } from "../_shared/workspace-keys.ts";
import { handleAdminRoutes } from "./admin.ts";

const SUPER = 744230399;
const ADMIN_CEE = 101;
const NOBODY = 303;
const WS_KEY = "sk-workspace-2222222222222222";
const noNames = () => Promise.resolve(new Map<number, string>());
const okFetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;

function setup() {
  Deno.env.set("WORKSPACE_SECRETS_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(3))));
  Deno.env.delete("WORKSPACE_OWN_KEYS");
  resetKeyCache();
  return makeFakeDb({ workspaces: [{ id: "cee" }, { id: "demo" }] });
}

async function call(
  db: ReturnType<typeof makeFakeDb>,
  method: string,
  path: string,
  tid: number,
  isAdmin: boolean,
  groupId: string,
  body?: unknown,
  names: (ids: number[]) => Promise<Map<number, string>> = noNames,
) {
  const res = await handleAdminRoutes(
    db.client,
    new Request(`https://x${path}`, {
      method,
      body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    }),
    path,
    tid,
    isAdmin,
    "*",
    names,
    groupId,
    { fetchImpl: okFetch },
  );
  return res!;
}

Deno.test("openai-key: админ своего пространства задаёт, читает статус и снимает; ключа в ответах нет", async () => {
  const db = setup();
  const put = await call(db, "PUT", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee", { key: WS_KEY });
  assertEquals(put.status, 200);
  const putText = await put.text();
  assert(!putText.includes(WS_KEY));
  assertEquals(JSON.parse(putText).last4, WS_KEY.slice(-4));

  const get = await call(db, "GET", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee");
  const getText = await get.text();
  assert(!getText.includes(WS_KEY));
  assertEquals(JSON.parse(getText).source, "workspace");

  const del = await call(db, "DELETE", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee");
  assertEquals((await del.json()).source, "server");
});

Deno.test("openai-key: админ ЧУЖОГО пространства — 404 и ничего не записано", async () => {
  const db = setup();
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await call(db, method, "/admin/workspaces/demo/openai-key", ADMIN_CEE, true, "cee", { key: WS_KEY });
    assertEquals(res.status, 404, method);
    await res.body?.cancel();
  }
  assertEquals(db.tables.workspace_secrets.length, 0);
});

Deno.test("openai-key: не админ — 403", async () => {
  const db = setup();
  const res = await call(db, "PUT", "/admin/workspaces/cee/openai-key", NOBODY, false, "cee", { key: WS_KEY });
  assertEquals(res.status, 403);
  assertEquals(db.tables.workspace_secrets.length, 0);
});

Deno.test("openai-key: суперадмин задаёт ключ любому существующему пространству, несуществующее — 404", async () => {
  const db = setup();
  const ok = await call(db, "PUT", "/admin/workspaces/demo/openai-key", SUPER, true, "cee", { key: WS_KEY });
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
  assertEquals(db.tables.workspace_secrets[0].group_id, "demo");
  const none = await call(db, "PUT", "/admin/workspaces/nope/openai-key", SUPER, true, "cee", { key: WS_KEY });
  assertEquals(none.status, 404);
  await none.body?.cancel();
});

Deno.test("openai-key: плохой ключ — 400 без эха ключа, битый JSON — 400", async () => {
  const db = setup();
  const bad = await call(db, "PUT", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee", { key: "nope" });
  assertEquals(bad.status, 400);
  // ответ несёт машинный код: экран показывает текст на своём языке по нему
  assertEquals(await bad.json(), {
    error: 'The key must start with "sk-" and contain no spaces.',
    code: "invalid_format",
  });
  const res = await handleAdminRoutes(
    db.client,
    new Request("https://x/a", { method: "PUT", body: "{" }),
    "/admin/workspaces/cee/openai-key",
    ADMIN_CEE,
    true,
    "*",
    noNames,
    "cee",
  );
  assertEquals(res!.status, 400);
  await res!.body?.cancel();
});

Deno.test("master-admins: только суперадмин; обычный админ — 403", async () => {
  const db = setup();
  for (
    const [method, path, body] of [
      ["GET", "/admin/master-admins", undefined],
      ["POST", "/admin/master-admins", { telegram_id: 777 }],
      ["DELETE", "/admin/master-admins/777", undefined],
    ] as const
  ) {
    const res = await call(db, method, path, ADMIN_CEE, true, "cee", body);
    assertEquals(res.status, 403, method);
    await res.body?.cancel();
  }
  assertEquals(db.tables.master_admins.length, 0);
});

Deno.test("master-admins: суперадмин видит список, добавляет и снимает; константного снять нельзя", async () => {
  const db = setup();
  const add = await call(db, "POST", "/admin/master-admins", SUPER, true, "cee", { telegram_id: 777 });
  assertEquals(add.status, 201);
  await add.body?.cancel();
  const list = await (await call(db, "GET", "/admin/master-admins", SUPER, true, "cee")).json();
  assertEquals(list.map((r: { telegram_id: number }) => r.telegram_id).sort(), [777, SUPER].sort());

  const builtin = await call(db, "DELETE", `/admin/master-admins/${SUPER}`, SUPER, true, "cee");
  assertEquals(builtin.status, 409);
  await builtin.body?.cancel();

  const del = await call(db, "DELETE", "/admin/master-admins/777", SUPER, true, "cee");
  assertEquals(del.status, 409); // единственная строка в таблице — последняя
  await del.body?.cancel();
});

Deno.test("master-admins: в списке имена из профилей, без имени — null; ошибки с машинным кодом", async () => {
  const db = setup();
  const names = (ids: number[]) => Promise.resolve(new Map(ids.filter((i) => i === SUPER).map((i) => [i, "Владелец"])));
  const add = await call(db, "POST", "/admin/master-admins", SUPER, true, "cee", { telegram_id: 777 }, names);
  const list = await add.json() as Array<{ telegram_id: number; name: string | null }>;
  assertEquals(list.find((r) => r.telegram_id === SUPER)?.name, "Владелец");
  assertEquals(list.find((r) => r.telegram_id === 777)?.name, null);

  const bad = await call(db, "POST", "/admin/master-admins", SUPER, true, "cee", { telegram_id: -5 });
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).code, "invalid_id");
  const builtin = await call(db, "DELETE", `/admin/master-admins/${SUPER}`, SUPER, true, "cee");
  assertEquals((await builtin.json()).code, "builtin");
  const missing = await call(db, "DELETE", "/admin/master-admins/999", SUPER, true, "cee");
  assertEquals(missing.status, 404);
  assertEquals((await missing.json()).code, "not_found");
});

Deno.test("openai-key: статус отдаёт режим сервера (выключатель, ключ сервера), но не ключи", async () => {
  const db = setup();
  Deno.env.set("OPENAI_API_KEY", "sk-server-3333333333333333");
  try {
    const on = await (await call(db, "GET", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee")).text();
    assertEquals(JSON.parse(on).own_keys_enabled, true);
    assertEquals(JSON.parse(on).server_key_available, true);
    assert(!on.includes("sk-server-3333333333333333"));
    Deno.env.set("WORKSPACE_OWN_KEYS", "off");
    const off = await (await call(db, "GET", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee")).json();
    assertEquals(off.own_keys_enabled, false);
  } finally {
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("WORKSPACE_OWN_KEYS");
  }
});

// ── Видимость: раздел мастер-админа — только мастеру; ключ — админу СВОЕГО пространства (#233) ──

Deno.test("видимость: участник (не админ) не видит и не меняет ничего из админки — 403 на каждом маршруте", async () => {
  const db = setup();
  for (
    const [m, p, b] of [
      ["GET", "/admin/workspaces/cee/openai-key", undefined],
      ["PUT", "/admin/workspaces/cee/openai-key", { key: WS_KEY }],
      ["DELETE", "/admin/workspaces/cee/openai-key", undefined],
      ["GET", "/admin/master-admins", undefined],
      ["GET", "/admin/ai-health", undefined],
      ["PUT", "/admin/workspaces/cee/users/555/admin", { is_admin: true }],
      ["POST", "/admin/workspaces", { id: "new", name: "New" }],
    ] as Array<[string, string, unknown]>
  ) {
    const res = await call(db, m, p, NOBODY, false, "cee", b);
    assertEquals(res.status, 403, `${m} ${p}`);
    await res.body?.cancel();
  }
  assertEquals(db.tables.workspace_secrets.length, 0);
});

Deno.test("видимость: админ пространства не создаёт пространства, не видит мастер-админов и не назначает админов", async () => {
  const db = setup();
  for (
    const [m, p, b] of [
      ["POST", "/admin/workspaces", { id: "new", name: "New" }],
      ["GET", "/admin/master-admins", undefined],
      ["POST", "/admin/master-admins", { telegram_id: 777 }],
      ["PUT", "/admin/workspaces/cee/users/555/admin", { is_admin: true }],
    ] as Array<[string, string, unknown]>
  ) {
    const res = await call(db, m, p, ADMIN_CEE, true, "cee", b);
    assertEquals(res.status, 403, `${m} ${p}`);
    await res.body?.cancel();
  }
  assertEquals(db.tables.workspaces.length, 2);
  assertEquals(db.tables.master_admins.length, 0);
});

Deno.test("мастер создаёт пространство и назначает/снимает его админа; пользователь из чужого пространства — 404", async () => {
  const db = setup();
  db.tables.allowed_users = [
    { telegram_id: 555, group_id: "cee", is_admin: false },
    { telegram_id: 556, group_id: "demo", is_admin: false },
  ];
  const created = await call(db, "POST", "/admin/workspaces", SUPER, true, "cee", { id: "new", name: "New" });
  assertEquals(created.status, 201);
  await created.body?.cancel();
  assertEquals(db.tables.workspaces.length, 3);

  const on = await call(db, "PUT", "/admin/workspaces/cee/users/555/admin", SUPER, true, "cee", { is_admin: true });
  assertEquals(on.status, 200);
  await on.body?.cancel();
  assertEquals(db.tables.allowed_users[0].is_admin, true);

  const off = await call(db, "PUT", "/admin/workspaces/cee/users/555/admin", SUPER, true, "cee", { is_admin: false });
  await off.body?.cancel();
  assertEquals(db.tables.allowed_users[0].is_admin, false);

  const foreign = await call(db, "PUT", "/admin/workspaces/cee/users/556/admin", SUPER, true, "cee", {
    is_admin: true,
  });
  assertEquals(foreign.status, 404);
  await foreign.body?.cancel();
  assertEquals(db.tables.allowed_users[1].is_admin, false);

  const bad = await call(db, "PUT", "/admin/workspaces/cee/users/555/admin", SUPER, true, "cee", { is_admin: "yes" });
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
});

Deno.test("ключ: админ чужого пространства ключ не задаёт (404); админ своего — задаёт", async () => {
  const db = setup();
  const foreign = await call(db, "PUT", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "demo", { key: WS_KEY });
  assertEquals(foreign.status, 404);
  await foreign.body?.cancel();
  assertEquals(db.tables.workspace_secrets.length, 0);
  const ok = await call(db, "PUT", "/admin/workspaces/demo/openai-key", ADMIN_CEE, true, "demo", { key: WS_KEY });
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
});

Deno.test("ключ без WORKSPACE_SECRETS_KEY: 503 storage_unavailable, статус честно говорит «хранилища нет»", async () => {
  const db = setup();
  Deno.env.delete("WORKSPACE_SECRETS_KEY");
  const put = await call(db, "PUT", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee", { key: WS_KEY });
  assertEquals(put.status, 503);
  assertEquals((await put.json()).code, "storage_unavailable");
  const st = await (await call(db, "GET", "/admin/workspaces/cee/openai-key", ADMIN_CEE, true, "cee")).json();
  assertEquals(st.storage_available, false);
  assertEquals(db.tables.workspace_secrets.length, 0);
});

// ── Баннер сбоя ключа ────────────────────────────────────────────────────────

Deno.test("ai-health: админ видит сбои и встало-в-обработке только своего пространства; мастер — всех", async () => {
  const db = setup();
  const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
  db.tables.ai_key_health = [
    {
      group_id: "cee",
      source: "workspace",
      failing: true,
      reason: "rejected",
      first_failure_at: old,
      last_failure_at: old,
    },
    { group_id: "demo", source: "server", failing: true, reason: "quota", first_failure_at: old, last_failure_at: old },
    { group_id: "", source: "server", failing: true, reason: "quota", first_failure_at: old, last_failure_at: old },
  ];
  db.tables.meetings = [
    { group_id: "cee", summary_status: "processing", created_at: old, ended_at: old, last_progress_at: old },
    {
      group_id: "cee",
      summary_status: "processing",
      created_at: new Date().toISOString(),
      ended_at: null,
      last_progress_at: null,
    },
    { group_id: "demo", summary_status: "processing", created_at: old, ended_at: old, last_progress_at: old },
  ];
  const mine = await (await call(db, "GET", "/admin/ai-health", ADMIN_CEE, true, "cee")).json();
  assertEquals(mine.issues.map((i: { group_id: string }) => i.group_id), ["cee"]);
  assertEquals(mine.issues[0].workspace_name, "cee");
  assertEquals(mine.stalled.map((s: { group_id: string; count: number }) => [s.group_id, s.count]), [["cee", 1]]);

  const all = await (await call(db, "GET", "/admin/ai-health", SUPER, true, "cee")).json();
  assertEquals(all.issues.map((i: { group_id: string }) => i.group_id).sort(), ["", "cee", "demo"]);
  assertEquals(all.stalled.length, 2);
});

Deno.test("master-admins: выдача и снятие роли пишутся в журнал (кто, кому, когда); отказ не пишется", async () => {
  const db = setup();
  const lines: string[] = [];
  const orig = console.log;
  console.log = (m: unknown) => void lines.push(String(m));
  try {
    for (
      const [m, p, b] of [
        ["POST", "/admin/master-admins", { telegram_id: 777 }],
        ["POST", "/admin/master-admins", { telegram_id: 778 }],
        ["DELETE", "/admin/master-admins/777", undefined],
        ["POST", "/admin/master-admins", { telegram_id: -1 }],
        ["DELETE", "/admin/master-admins/999", undefined],
      ] as Array<[string, string, unknown]>
    ) {
      await (await call(db, m, p, SUPER, true, "cee", b)).body?.cancel();
    }
  } finally {
    console.log = orig;
  }
  const events = lines.map((l) => JSON.parse(l));
  assertEquals(events.map((e) => [e.event, e.actor, e.target]), [
    ["master_admin_added", SUPER, 777],
    ["master_admin_added", SUPER, 778],
    ["master_admin_removed", SUPER, 777],
  ]);
  assert(events.every((e) => !Number.isNaN(Date.parse(e.at))));
});
