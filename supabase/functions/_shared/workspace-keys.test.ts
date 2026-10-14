import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { makeFakeDb } from "./workspace-keys.fake.ts";
import {
  clearOpenAIKey,
  getOpenAIKey,
  keyStatus,
  resetKeyCache,
  setOpenAIKey,
  WorkspaceKeyError,
} from "./workspace-keys.ts";
import { sealSecret } from "./secret-box.ts";

const ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const SERVER_KEY = "sk-server-000000000000000000";
const WS_KEY = "sk-workspace-1111111111111111";
const ACTOR = 111;

const okFetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
const statusFetch = (s: number) => (() => Promise.resolve(new Response("{}", { status: s }))) as typeof fetch;

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  resetKeyCache();
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    resetKeyCache();
  }
}

const BASE = { WORKSPACE_SECRETS_KEY: ENC_KEY, OPENAI_API_KEY: SERVER_KEY, WORKSPACE_OWN_KEYS: undefined };

Deno.test("getOpenAIKey: нет строки у пространства → ключ сервера", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb();
    assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY);
  }));

Deno.test("getOpenAIKey: свой ключ пространства имеет приоритет и не мешает другому пространству", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }, { id: "demo" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    assertEquals(await getOpenAIKey(db.client, "cee"), WS_KEY);
    assertEquals(await getOpenAIKey(db.client, "demo"), SERVER_KEY);
  }));

Deno.test("getOpenAIKey: выключатель WORKSPACE_OWN_KEYS=off → ключ сервера, в базу не ходит", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    resetKeyCache();
    Deno.env.set("WORKSPACE_OWN_KEYS", "off");
    const before = db.reads.workspace_secrets ?? 0;
    assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY);
    assertEquals(db.reads.workspace_secrets ?? 0, before);
    assertEquals((await keyStatus(db.client, "cee")).source, "server");
  }));

Deno.test("getOpenAIKey: сбой расшифровки — ошибка, а не молчаливый ключ сервера", () =>
  withEnv(BASE, async () => {
    // Строка зашифрована под другое пространство (чужой AAD) — как подмена строки в базе.
    const forged = await sealSecret(WS_KEY, "demo:openai");
    const db = makeFakeDb({
      workspace_secrets: [{ group_id: "cee", kind: "openai", ...forged, last4: "1111", set_by: 1, set_at: "x" }],
    });
    await assertRejects(() => getOpenAIKey(db.client, "cee"), Error, "не расшифровывается");
  }));

Deno.test("getOpenAIKey: кэш держит ответ, set и clear его сбрасывают", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    await getOpenAIKey(db.client, "cee");
    await getOpenAIKey(db.client, "cee");
    assertEquals(db.reads.workspace_secrets, 1);

    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    assertEquals(await getOpenAIKey(db.client, "cee"), WS_KEY);

    await clearOpenAIKey(db.client, "cee");
    assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY);
  }));

Deno.test("setOpenAIKey: 401 от OpenAI → отказ «не принят», ничего не записано", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    const err = await assertRejects(
      () => setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, statusFetch(401)),
      WorkspaceKeyError,
    );
    assertEquals(err.code, "rejected");
    assertEquals(db.tables.workspace_secrets.length, 0);
  }));

Deno.test("setOpenAIKey: сеть или 5xx → «не удалось проверить», ничего не записано", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    const boom = (() => Promise.reject(new Error("net"))) as typeof fetch;
    for (const f of [boom, statusFetch(500)]) {
      const err = await assertRejects(() => setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, f), WorkspaceKeyError);
      assertEquals(err.code, "unverifiable");
    }
    assertEquals(db.tables.workspace_secrets.length, 0);
  }));

Deno.test("setOpenAIKey: плохой формат отбивается до запроса к OpenAI", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    let called = false;
    const spy = (() => ((called = true), Promise.resolve(new Response("{}")))) as typeof fetch;
    for (const bad of ["", "abc", "sk-short", "sk-has space 0000000000000000", 42, null]) {
      const err = await assertRejects(() => setOpenAIKey(db.client, "cee", bad, ACTOR, spy), WorkspaceKeyError);
      assertEquals(err.code, "invalid_format");
    }
    assert(!called);
  }));

Deno.test("setOpenAIKey: key обрезается по краям; в базе шифротекст, статус и ошибки без ключа", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    let auth = "";
    const spy = ((_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    const status = await setOpenAIKey(db.client, "cee", `  ${WS_KEY}\n`, ACTOR, spy);
    assertEquals(auth, `Bearer ${WS_KEY}`);
    assertEquals(status.source, "workspace");
    assertEquals(status.last4, WS_KEY.slice(-4));
    assertEquals(status.set_by, ACTOR);
    assert(!JSON.stringify(status).includes(WS_KEY));
    assert(!JSON.stringify(db.tables.workspace_secrets).includes(WS_KEY));
    assert(!JSON.stringify(db.tables.workspace_secrets).includes("workspace-111"));
    // отказ тоже не светит ключ
    const err = await assertRejects(() => setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, statusFetch(401)), Error);
    assert(!err.message.includes(WS_KEY));
  }));

Deno.test("keyStatus: без своего ключа — server и пустые поля", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb();
    assertEquals(await keyStatus(db.client, "cee"), { source: "server", last4: null, set_at: null, set_by: null });
  }));
