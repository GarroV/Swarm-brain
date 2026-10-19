import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { makeFakeDb } from "./workspace-keys.fake.ts";
import {
  clearOpenAIKey,
  getOpenAIKey,
  keyStatus,
  noteOpenAIResponse,
  openAIKeyHandle,
  reportKeyRejected,
  resetKeyCache,
  resolveOpenAIKey,
  setOpenAIKey,
  WorkspaceKeyError,
} from "./workspace-keys.ts";
import { sealSecret } from "./secret-box.ts";

const ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const SERVER_KEY = "sk-server-000000000000000000";
const WS_KEY = "sk-workspace-1111111111111111";
const ACTOR = 111;

const noSend = () => Promise.resolve();
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
    assertEquals(await keyStatus(db.client, "cee"), {
      source: "server",
      last4: null,
      set_at: null,
      set_by: null,
      last_error: null,
      last_error_at: null,
      own_keys_enabled: true,
      server_key_available: true,
      storage_available: true,
    });
  }));

Deno.test("keyStatus: режим берётся от сервера — выключатель и наличие ключа сервера", () =>
  withEnv({ ...BASE, WORKSPACE_OWN_KEYS: "off" }, async () => {
    const off = await keyStatus(makeFakeDb().client, "cee");
    assertEquals(off.own_keys_enabled, false);
    assertEquals(off.server_key_available, true);
  }).then(() =>
    withEnv({ ...BASE, OPENAI_API_KEY: undefined }, async () => {
      const none = await keyStatus(makeFakeDb().client, "cee");
      assertEquals(none.own_keys_enabled, true);
      assertEquals(none.server_key_available, false);
    })
  ));

Deno.test("keyStatus: режим не выдаёт ни ключ сервера, ни ключ пространства", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb();
    await setOpenAIKey(db.client, "cee", WS_KEY, 1, okFetch);
    const text = JSON.stringify(await keyStatus(db.client, "cee"));
    assert(!text.includes(WS_KEY));
    assert(!text.includes(SERVER_KEY));
  }));

Deno.test("getOpenAIKey: без пространства (null/undefined/пусто) → ключ сервера, в базу не ходит", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    const before = db.reads.workspace_secrets ?? 0;
    for (const g of [null, undefined, ""]) {
      assertEquals(await getOpenAIKey(db.client, g), SERVER_KEY);
      assertEquals((await resolveOpenAIKey(db.client, g)).source, "server");
    }
    assertEquals(db.reads.workspace_secrets ?? 0, before);
  }));

Deno.test("resolveOpenAIKey: источник — workspace у пространства со своим ключом, server у остальных", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }, { id: "demo" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    assertEquals(await resolveOpenAIKey(db.client, "cee"), { key: WS_KEY, source: "workspace" });
    assertEquals(await resolveOpenAIKey(db.client, "demo"), { key: SERVER_KEY, source: "server" });
  }));

Deno.test("reportKeyRejected: 401 на ключе пространства пишет ошибку; ключ сервера не подставляется", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    const handle = await openAIKeyHandle(db.client, "cee");
    assertEquals(handle.key, WS_KEY);
    await handle.noteResponse({ status: 401 });
    const st = await keyStatus(db.client, "cee");
    assertEquals(st.last_error, "rejected");
    assert(st.last_error_at !== null);
    // дальше вызовы по-прежнему идут ключом пространства (и падают как обычно), а не чужим
    assertEquals(await getOpenAIKey(db.client, "cee"), WS_KEY);
    assert(!JSON.stringify(st).includes(WS_KEY));
  }));

Deno.test("noteOpenAIResponse: не-401 и ключ сервера ничего не пишут", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }, { id: "demo" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    const own = await resolveOpenAIKey(db.client, "cee");
    for (const status of [200, 429, 500]) await noteOpenAIResponse(db.client, "cee", own, { status });
    // 401 на ключе сервера (у demo своего ключа нет) — это не отказ ключа пространства
    const server = await resolveOpenAIKey(db.client, "demo");
    await noteOpenAIResponse(db.client, "demo", server, { status: 401 });
    await noteOpenAIResponse(db.client, null, server, { status: 401 });
    assertEquals((await keyStatus(db.client, "cee")).last_error, null);
    assertEquals(db.tables.workspace_secrets.length, 1);
  }));

Deno.test("setOpenAIKey: новый ключ очищает прежнюю ошибку", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    await reportKeyRejected(db.client, "cee");
    assertEquals((await keyStatus(db.client, "cee")).last_error, "rejected");
    const after = await setOpenAIKey(db.client, "cee", "sk-workspace-2222222222222222", ACTOR, okFetch);
    assertEquals(after.last_error, null);
    assertEquals(after.last_error_at, null);
  }));

Deno.test("WorkspaceKeyError: тексты по-английски, код машинный", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }] });
    const bad = await assertRejects(() => setOpenAIKey(db.client, "cee", "nope", ACTOR, okFetch), WorkspaceKeyError);
    assertEquals([bad.code, bad.message], ["invalid_format", 'The key must start with "sk-" and contain no spaces.']);
    const rej = await assertRejects(
      () => setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, statusFetch(401)),
      WorkspaceKeyError,
    );
    assertEquals([rej.code, rej.message], ["rejected", "OpenAI rejected the key."]);
  }));

Deno.test("resetKeyCache: с id сбрасывает только это пространство, без аргумента — все", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee" }, { id: "demo" }] });
    await getOpenAIKey(db.client, "cee");
    await getOpenAIKey(db.client, "demo");
    assertEquals(db.reads.workspace_secrets, 2);

    resetKeyCache("cee");
    await getOpenAIKey(db.client, "demo"); // из кэша
    assertEquals(db.reads.workspace_secrets, 2);
    await getOpenAIKey(db.client, "cee"); // сброшено → читаем заново
    assertEquals(db.reads.workspace_secrets, 3);

    resetKeyCache();
    await getOpenAIKey(db.client, "cee");
    await getOpenAIKey(db.client, "demo");
    assertEquals(db.reads.workspace_secrets, 5);
  }));

// ── Раскатка рядом с общим ключом: любое сочетание «секрет есть/нет, миграция есть/нет» не ломает команду ──

Deno.test("раскатка: нет WORKSPACE_SECRETS_KEY — пространства без своего ключа работают на ключе сервера", () =>
  withEnv({ ...BASE, WORKSPACE_SECRETS_KEY: undefined }, async () => {
    const db = makeFakeDb();
    assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY);
    assertEquals((await resolveOpenAIKey(db.client, "cee")).source, "server");
    const st = await keyStatus(db.client, "cee");
    assertEquals(st.source, "server");
    assertEquals(st.storage_available, false);
  }));

Deno.test("раскатка: нет WORKSPACE_SECRETS_KEY — ключ задать нельзя: понятный отказ, OpenAI не зовём, ничего не записано", () =>
  withEnv({ ...BASE, WORKSPACE_SECRETS_KEY: undefined }, async () => {
    const db = makeFakeDb();
    let called = false;
    const spy = (() => ((called = true), Promise.resolve(new Response("{}")))) as typeof fetch;
    const e = await assertRejects(() => setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, spy), WorkspaceKeyError);
    assertEquals(e.code, "storage_unavailable");
    assertEquals(e.status, 503);
    assertEquals(called, false);
    assertEquals(db.tables.workspace_secrets.length, 0);
  }));

Deno.test("раскатка: кривой WORKSPACE_SECRETS_KEY считается недоступным хранилищем, а не падением", () =>
  withEnv({ ...BASE, WORKSPACE_SECRETS_KEY: "не-base64!!" }, async () => {
    const db = makeFakeDb();
    assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY);
    assertEquals((await keyStatus(db.client, "cee")).storage_available, false);
  }));

Deno.test("раскатка: миграция не накатана (таблицы нет) — вызовы идут на ключе сервера, статус не падает", () =>
  withEnv(BASE, async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const db = makeFakeDb({}, { workspace_secrets: { code } });
      assertEquals(await getOpenAIKey(db.client, "cee"), SERVER_KEY, code);
      const st = await keyStatus(db.client, "cee");
      assertEquals(st.source, "server", code);
      assertEquals(st.storage_available, false, code);
    }
  }));

Deno.test("раскатка: другая ошибка базы НЕ маскируется ключом сервера", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({}, { workspace_secrets: { code: "57014" } });
    await assertRejects(() => getOpenAIKey(db.client, "cee"));
  }));

Deno.test("раскатка по умолчанию: свой ключ действует у пространства, у остальных — ключ сервера", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb();
    await setOpenAIKey(db.client, "cee", WS_KEY, ACTOR, okFetch);
    assertEquals(await getOpenAIKey(db.client, "cee"), WS_KEY);
    assertEquals(await getOpenAIKey(db.client, "demo"), SERVER_KEY);
    assertEquals((await keyStatus(db.client, "demo")).own_keys_enabled, true);
  }));

// ── Сигнал о сбое: единая точка noteOpenAIResponse пишет исход и по ключу пространства, и по серверному ──

const quotaRes = () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 });

Deno.test("noteOpenAIResponse: 429 с кодом квоты на КЛЮЧЕ СЕРВЕРА — тревога у пространства, где вызов упал", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee", name: "IMF" }] });
    const resolved = await resolveOpenAIKey(db.client, "cee");
    await noteOpenAIResponse(db.client, "cee", resolved, quotaRes(), noSend);
    const row = db.tables.ai_key_health[0];
    assertEquals([row.group_id, row.source, row.failing, row.reason], ["cee", "server", true, "quota"]);
  }));

Deno.test("noteOpenAIResponse: успешный ответ после сбоя гасит тревогу; 400 её не гасит", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({ workspaces: [{ id: "cee", name: "IMF" }] });
    const resolved = await resolveOpenAIKey(db.client, "cee");
    await noteOpenAIResponse(db.client, "cee", resolved, { status: 401 }, noSend);
    await noteOpenAIResponse(db.client, "cee", resolved, { status: 400 }, noSend);
    assertEquals(db.tables.ai_key_health[0].failing, true);
    await noteOpenAIResponse(db.client, "cee", resolved, { status: 200 }, noSend);
    assertEquals(db.tables.ai_key_health[0].failing, false);
  }));

Deno.test("noteOpenAIResponse: сбой записи состояния не роняет вызов", () =>
  withEnv(BASE, async () => {
    const db = makeFakeDb({}, { ai_key_health: { code: "42P01" } });
    const resolved = await resolveOpenAIKey(db.client, "cee");
    await noteOpenAIResponse(db.client, "cee", resolved, { status: 401 }, noSend); // не бросает
  }));
