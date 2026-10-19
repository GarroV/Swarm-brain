import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finishStep, startStep } from "./flow.ts";
import { MemoryStore } from "./memory-store.ts";
import { MAX_CHALLENGES_PER_WINDOW } from "./rp.ts";
import { SoftAuthenticator } from "./test-authenticator.ts";

const ORIGIN = "https://swarm-team.app";
const RP_ID = "swarm-team.app";
const ANNA = 1001;
const BORIS = 1002;

function setup() {
  let t = 1_800_000_000_000;
  const clock = () => t;
  const store = new MemoryStore(clock);
  const deps = { store, now: clock };
  return { store, deps, advance: (ms: number) => (t += ms) };
}

type Deps = ReturnType<typeof setup>["deps"];

async function start(deps: Deps, telegramId: number, origin: unknown = ORIGIN, here = false) {
  return await startStep(deps, { telegramId, origin, userName: `u${telegramId}`, here });
}

/** Сохранить ключ человеку: полный проход create. */
async function enroll(deps: Deps, telegramId: number, device: SoftAuthenticator) {
  const s = await start(deps, telegramId);
  assert(s.ok && s.mode === "create");
  const cred = await device.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  return await finishStep(deps, { telegramId, origin: ORIGIN, name: "Chrome · Mac", credential: cred });
}

Deno.test("create: платформенный ключ, без вопросов, UV обязателен, окно — встроенный датчик", async () => {
  const { deps } = setup();
  const s = await start(deps, ANNA);
  assert(s.ok && s.mode === "create");
  const sel = s.options.authenticatorSelection as Record<string, string>;
  assertEquals(sel.authenticatorAttachment, "platform");
  assertEquals(sel.residentKey, "required");
  assertEquals(sel.userVerification, "required");
  assertEquals(s.options.hints, ["client-device"]);
  assertEquals((s.options.rp as { id: string }).id, RP_ID);
});

Deno.test("сохранение ключа: настоящий ответ принимается, ключ лежит у человека", async () => {
  const { deps, store } = setup();
  const device = await SoftAuthenticator.create();
  assertEquals(await enroll(deps, ANNA, device), { ok: true, mode: "create" });
  assertEquals(store.keys.length, 1);
  assertEquals(store.keys[0].telegramId, ANNA);
  assertEquals(store.keys[0].credentialId, device.id);
});

Deno.test("ключ есть: подтверждение (get) с перечнем ключей человека; счётчик растёт", async () => {
  const { deps, store } = setup();
  const device = await SoftAuthenticator.create();
  await enroll(deps, ANNA, device);
  const s = await start(deps, ANNA, ORIGIN, true);
  assert(s.ok && s.mode === "get");
  assertEquals((s.options.allowCredentials as Array<{ id: string }>).map((c) => c.id), [device.id]);
  assertEquals(s.options.userVerification, "required");
  const r = await finishStep(deps, {
    telegramId: ANNA,
    origin: ORIGIN,
    credential: await device.assert({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID }),
  });
  assertEquals(r, { ok: true, mode: "get" });
  assertEquals(store.keys[0].signCount, 1);
});

Deno.test("ключей нет (первый вход или админ сбросил вход): палец сохраняется сам (create)", async () => {
  const { deps, store } = setup();
  const device = await SoftAuthenticator.create();
  await enroll(deps, ANNA, device);
  // Сброс входа админом: ключей нет — снова «первый вход».
  await store.deleteForPerson(ANNA);
  const s = await start(deps, ANNA);
  assert(s.ok && s.mode === "create");
});

Deno.test("новый браузер (метки нет), ключи у человека есть: create с excludeCredentials, не get", async () => {
  const { deps } = setup();
  const first = await SoftAuthenticator.create();
  await enroll(deps, ANNA, first);
  const s = await start(deps, ANNA, ORIGIN, false);
  assert(s.ok && s.mode === "create", "без метки в браузере режим get недопустим");
  assertEquals((s.options.excludeCredentials as Array<{ id: string }>).map((c) => c.id), [first.id]);
});

Deno.test("браузер с меткой, ключи есть: подтверждение (get)", async () => {
  const { deps } = setup();
  await enroll(deps, ANNA, await SoftAuthenticator.create());
  const s = await start(deps, ANNA, ORIGIN, true);
  assert(s.ok && s.mode === "get");
});

Deno.test("метка есть, а ключей у человека нет (админ сбросил вход): create", async () => {
  const { deps } = setup();
  const s = await start(deps, ANNA, ORIGIN, true);
  assert(s.ok && s.mode === "create");
});

Deno.test("сохранение принимается, даже если у человека уже есть ключ (второй браузер)", async () => {
  const { deps, store } = setup();
  const second = await SoftAuthenticator.create();
  await store.insertPasskey({
    telegramId: ANNA,
    credentialId: "other-browser",
    publicKey: "p",
    signCount: 0,
    transports: [],
    name: "Safari · Mac",
  });
  const s = await start(deps, ANNA, ORIGIN, false);
  assert(s.ok && s.mode === "create");
  const cred = await second.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, name: "Chrome · Mac", credential: cred }), {
    ok: true,
    mode: "create",
  });
  assertEquals(store.keys.map((k) => k.credentialId).sort(), ["other-browser", second.id].sort());
});

Deno.test("чужой origin: и выдача, и приём отказывают", async () => {
  const { deps } = setup();
  assertEquals(await start(deps, ANNA, "https://evil.example"), { ok: false, reason: "origin" });
  const device = await SoftAuthenticator.create();
  const s = await start(deps, ANNA);
  assert(s.ok);
  const cred = await device.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: "https://evil.example", credential: cred }), {
    ok: false,
    reason: "origin",
  });
});

Deno.test("ответ с чужого сайта (clientData.origin не тот): отказ, ключ не сохранён", async () => {
  const { deps, store } = setup();
  const device = await SoftAuthenticator.create();
  const s = await start(deps, ANNA);
  assert(s.ok);
  const cred = await device.register({
    challenge: s.options.challenge as string,
    origin: "https://evil.example",
    rpID: RP_ID,
  });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
  assertEquals(store.keys.length, 0);
});

Deno.test("вызов снимается один раз: повтор того же ответа не проходит", async () => {
  const { deps } = setup();
  const device = await SoftAuthenticator.create();
  await enroll(deps, ANNA, device);
  const s = await start(deps, ANNA, ORIGIN, true);
  assert(s.ok);
  const cred = await device.assert({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals((await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred })).ok, true);
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("просроченный вызов (2 минуты) не принимается", async () => {
  const { deps, advance } = setup();
  const device = await SoftAuthenticator.create();
  const s = await start(deps, ANNA);
  assert(s.ok);
  const cred = await device.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  advance(2 * 60 * 1000 + 1);
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("чужой вызов: ответ на вызов Анны от имени Бориса не проходит, а вызов Анны цел", async () => {
  const { deps } = setup();
  const device = await SoftAuthenticator.create();
  const sa = await start(deps, ANNA);
  assert(sa.ok);
  const cred = await device.register({ challenge: sa.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  // У Бориса вызова нет вовсе.
  assertEquals(await finishStep(deps, { telegramId: BORIS, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
  // У Бориса свой вызов, но подпись — на вызов Анны.
  const sb = await start(deps, BORIS);
  assert(sb.ok);
  assertNotEquals(sb.options.challenge, sa.options.challenge);
  assertEquals(await finishStep(deps, { telegramId: BORIS, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
  assertEquals((await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred })).ok, true);
});

Deno.test("новый вызов вытесняет прежний: по старому войти нельзя", async () => {
  const { deps } = setup();
  const device = await SoftAuthenticator.create();
  const first = await start(deps, ANNA);
  await start(deps, ANNA);
  assert(first.ok);
  const cred = await device.register({ challenge: first.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("ключ Анны шаг Бориса не подтверждает", async () => {
  const { deps } = setup();
  const annas = await SoftAuthenticator.create();
  const boris = await SoftAuthenticator.create();
  await enroll(deps, ANNA, annas);
  await enroll(deps, BORIS, boris);
  const s = await start(deps, BORIS, ORIGIN, true);
  assert(s.ok && s.mode === "get");
  const cred = await annas.assert({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: BORIS, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("неизвестный ключ: тот же единственный отказ", async () => {
  const { deps } = setup();
  const known = await SoftAuthenticator.create();
  const stranger = await SoftAuthenticator.create();
  await enroll(deps, ANNA, known);
  const s = await start(deps, ANNA);
  assert(s.ok);
  const cred = await stranger.assert({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("без проверки пользователя (UV) ни сохранение, ни подтверждение не проходят", async () => {
  const { deps, store } = setup();
  const device = await SoftAuthenticator.create();
  const s = await start(deps, ANNA);
  assert(s.ok);
  const bad = await device.register({
    challenge: s.options.challenge as string,
    origin: ORIGIN,
    rpID: RP_ID,
    userVerified: false,
  });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: bad }), {
    ok: false,
    reason: "failed",
  });
  assertEquals(store.keys.length, 0);
  await enroll(deps, ANNA, device);
  const g = await start(deps, ANNA);
  assert(g.ok);
  const noUv = await device.assert({
    challenge: g.options.challenge as string,
    origin: ORIGIN,
    rpID: RP_ID,
    userVerified: false,
  });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: noUv }), {
    ok: false,
    reason: "failed",
  });
});

Deno.test("откат счётчика подписей (клон ключа) отвергается", async () => {
  const { deps } = setup();
  const device = await SoftAuthenticator.create();
  await enroll(deps, ANNA, device);
  for (const counter of [5, 3]) {
    const s = await start(deps, ANNA, ORIGIN, true);
    assert(s.ok);
    const cred = await device.assert({
      challenge: s.options.challenge as string,
      origin: ORIGIN,
      rpID: RP_ID,
      counter,
    });
    const r = await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred });
    assertEquals(r.ok, counter === 5);
  }
});

Deno.test("ключ с нулевым счётчиком (синхронизируемый, Touch ID) входит снова и снова", async () => {
  const { deps } = setup();
  const device = await SoftAuthenticator.create();
  await enroll(deps, ANNA, device);
  for (let i = 0; i < 2; i++) {
    const s = await start(deps, ANNA, ORIGIN, true);
    assert(s.ok);
    const cred = await device.assert({
      challenge: s.options.challenge as string,
      origin: ORIGIN,
      rpID: RP_ID,
      counter: 0,
    });
    assertEquals((await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: cred })).ok, true);
  }
});

Deno.test("мусор вместо ответа: отказ без падения, вызов потрачен", async () => {
  const { deps } = setup();
  const s = await start(deps, ANNA);
  assert(s.ok);
  for (const junk of [null, 5, {}, { id: 7 }, { id: "x", response: {} }]) {
    assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: junk }), {
      ok: false,
      reason: "failed",
    });
  }
});

Deno.test("ограничитель: больше положенного числа вызовов за окно — 429, окно проходит — снова можно", async () => {
  const { deps, advance } = setup();
  for (let i = 0; i < MAX_CHALLENGES_PER_WINDOW; i++) assert((await start(deps, ANNA)).ok);
  assertEquals(await start(deps, ANNA), { ok: false, reason: "throttled" });
  assert((await start(deps, BORIS)).ok, "счётчик свой у каждого человека");
  advance(10 * 60 * 1000 + 1);
  assert((await start(deps, ANNA)).ok);
});

Deno.test("демо-сессии шаг не предлагается и не принимается", async () => {
  const { deps } = setup();
  assertEquals(await start(deps, 900000001), { ok: false, reason: "not_applicable" });
  assertEquals(await finishStep(deps, { telegramId: 900000001, origin: ORIGIN, credential: {} }), {
    ok: false,
    reason: "not_applicable",
  });
});
