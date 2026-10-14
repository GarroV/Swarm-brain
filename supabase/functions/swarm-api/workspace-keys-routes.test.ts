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
    noNames,
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
