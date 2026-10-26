// Свои ключи в профиле и ссылка «Добавить устройство» (решение 17.10.2026): менять можно только из
// сессии с пройденным вторым шагом; чужой ключ не удалить; неприменимой сессии — отказ.
import { assertEquals } from "jsr:@std/assert@1";
import { handleSelfPasskeyRoutes } from "./passkeys-self.ts";
import { MemoryStore } from "../_shared/passkeys/memory-store.ts";
import type { SecondStepState } from "../_shared/passkeys/second-step.ts";

const ANNA = 11;
const BORIS = 22;
const DONE: SecondStepState = {
  applies: true,
  done: true,
  required: false,
  required_from: null,
  session: 1,
  exchanged: false,
};
const NOT_DONE: SecondStepState = { ...DONE, done: false };
const NA: SecondStepState = {
  applies: false,
  done: false,
  required: false,
  required_from: null,
  session: null,
  exchanged: false,
};

async function seeded() {
  const store = new MemoryStore();
  for (const [telegramId, name] of [[ANNA, "Chrome · Mac"], [BORIS, "Safari · Mac"]] as const) {
    await store.insertPasskey({
      telegramId,
      credentialId: `c${telegramId}`,
      publicKey: "p",
      signCount: 0,
      transports: [],
      name,
    });
  }
  return store;
}

async function call(store: MemoryStore, method: string, path: string, secondStep: SecondStepState, who = ANNA) {
  const res = await handleSelfPasskeyRoutes(store, new Request("https://x", { method }), path, {
    telegramId: who,
    secondStep,
    origin: "https://swarm-team.app",
  });
  return res ? { status: res.status, body: await res.json() } : null;
}

Deno.test("список: только свои ключи, с названием и датой; can_manage — по пройденному шагу", async () => {
  const store = await seeded();
  const r = await call(store, "GET", "/me/passkeys", NOT_DONE);
  assertEquals(r?.status, 200);
  assertEquals(r?.body.keys.map((k: { name: string }) => k.name), ["Chrome · Mac"]);
  assertEquals(typeof r?.body.keys[0].created_at, "string");
  assertEquals(r?.body.can_manage, false);
  assertEquals((await call(store, "GET", "/me/passkeys", DONE))?.body.can_manage, true);
});

Deno.test("порча: выдача ссылки без пройденного шага — 403, ничего не записано", async () => {
  const store = await seeded();
  const r = await call(store, "POST", "/me/passkeys/device-link", NOT_DONE);
  assertEquals([r?.status, r?.body], [403, { error: "second_step_required" }]);
  assertEquals(store.links.length, 0);
});

Deno.test("ссылка выдаётся подтверждённой сессии: токен в ответе, в хранилище — только хеш", async () => {
  const store = await seeded();
  const r = await call(store, "POST", "/me/passkeys/device-link", DONE);
  assertEquals(r?.status, 200);
  assertEquals(typeof r?.body.token, "string");
  assertEquals(store.links.length, 1);
  assertEquals(store.links[0].tokenHash === r?.body.token, false);
  for (let i = 0; i < 4; i++) await call(store, "POST", "/me/passkeys/device-link", DONE);
  assertEquals((await call(store, "POST", "/me/passkeys/device-link", DONE))?.status, 429);
});

Deno.test("удаление: без пройденного шага — 403; чужой ключ — 404; свой — снят", async () => {
  const store = await seeded();
  const mine = store.keys.find((k) => k.telegramId === ANNA)!.id;
  const borisKey = store.keys.find((k) => k.telegramId === BORIS)!.id;
  assertEquals((await call(store, "DELETE", `/me/passkeys/${mine}`, NOT_DONE))?.status, 403);
  assertEquals((await call(store, "DELETE", `/me/passkeys/${borisKey}`, DONE))?.status, 404);
  assertEquals((await call(store, "DELETE", "/me/passkeys/not-a-uuid", DONE))?.status, 404);
  assertEquals((await call(store, "DELETE", `/me/passkeys/${mine}`, DONE))?.status, 200);
  assertEquals(store.keys.map((k) => k.telegramId), [BORIS]);
});

Deno.test("неприменимая сессия (демо, Mini App, короткий токен) — 403; чужие пути не перехватываются", async () => {
  const store = await seeded();
  assertEquals((await call(store, "GET", "/me/passkeys", NA))?.status, 403);
  assertEquals(await call(store, "GET", "/me", DONE), null);
  assertEquals(await call(store, "GET", "/me/passkeysX", DONE), null);
});
