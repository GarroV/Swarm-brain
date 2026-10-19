// «Добавить устройство» (решение владельца 17.10.2026): ссылка с подтверждённого устройства даёт
// телефону завести свой ключ. Ядро доступа — тесты на настоящей криптографии (SoftAuthenticator).
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finishStep, startStep } from "./flow.ts";
import {
  DEVICE_LINK_TTL_MS,
  finishEnrollment,
  hashDeviceToken,
  issueDeviceLink,
  MAX_DEVICE_LINKS_PER_WINDOW,
  startEnrollment,
} from "./device-link.ts";
import { MemoryStore } from "./memory-store.ts";
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

/** Анна с ключом на Маке (первый вход): второй шаг на Маке пройден. */
async function annaWithMac(deps: Deps) {
  const mac = await SoftAuthenticator.create();
  const s = await startStep(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", here: false });
  assert(s.ok && s.mode === "create");
  const cred = await mac.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assert((await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, name: "Chrome · Mac", credential: cred })).ok);
  return mac;
}

async function link(deps: Deps, telegramId = ANNA) {
  const r = await issueDeviceLink(deps, { telegramId, secondStepDone: true });
  assert(r.ok, "ссылка не выдана");
  return r.token;
}

/** Телефон проходит ссылку целиком: вызов → Face ID → приём. */
async function enrollPhone(deps: Deps, token: string, phone: SoftAuthenticator, telegramId = ANNA) {
  const s = await startEnrollment(deps, { telegramId, origin: ORIGIN, userName: "anna", token });
  if (!s.ok) return s;
  const cred = await phone.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  return await finishEnrollment(deps, { telegramId, origin: ORIGIN, token, name: "Safari · iPhone", credential: cred });
}

Deno.test("ссылку выдаёт только сессия с пройденным вторым шагом", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  assertEquals(await issueDeviceLink(deps, { telegramId: ANNA, secondStepDone: false }), {
    ok: false,
    reason: "second_step_required",
  });
  assertEquals(store.links.length, 0);
});

Deno.test("токен — 32 случайных байта, в базе только хеш, живёт 10 минут", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const r = await issueDeviceLink(deps, { telegramId: ANNA, secondStepDone: true });
  assert(r.ok);
  assert(/^[A-Za-z0-9_-]{43}$/.test(r.token), "не base64url от 32 байт");
  assertEquals(store.links.length, 1);
  assertEquals(store.links[0].tokenHash, await hashDeviceToken(r.token));
  assertNotEquals(store.links[0].tokenHash, r.token);
  assertEquals(r.expiresAt - deps.now(), DEVICE_LINK_TTL_MS);
  const again = await issueDeviceLink(deps, { telegramId: ANNA, secondStepDone: true });
  assert(again.ok);
  assertNotEquals(again.token, r.token);
});

Deno.test("телефон по ссылке заводит свой ключ: platform, resident, UV, чужие ключи исключены", async () => {
  const { deps, store } = setup();
  const mac = await annaWithMac(deps);
  const token = await link(deps);
  const s = await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token });
  assert(s.ok);
  const sel = s.options.authenticatorSelection as Record<string, string>;
  assertEquals(sel.authenticatorAttachment, "platform");
  assertEquals(sel.residentKey, "required");
  assertEquals(sel.userVerification, "required");
  assertEquals((s.options.excludeCredentials as Array<{ id: string }>).map((c) => c.id), [mac.id]);
  const phone = await SoftAuthenticator.create();
  const cred = await phone.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(
    await finishEnrollment(deps, {
      telegramId: ANNA,
      origin: ORIGIN,
      token,
      name: "Safari · iPhone",
      credential: cred,
    }),
    { ok: true },
  );
  assertEquals(store.keys.map((k) => k.credentialId), [mac.id, phone.id]);
  assertEquals((await store.describeForPerson(ANNA)).map((k) => k.name), ["Chrome · Mac", "Safari · iPhone"]);

  // Дальше телефон подтверждает вход своим ключом обычным вторым шагом.
  const g = await startStep(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", here: true });
  assert(g.ok && g.mode === "get");
  const asr = await phone.assert({ challenge: g.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  assertEquals(await finishStep(deps, { telegramId: ANNA, origin: ORIGIN, credential: asr }), {
    ok: true,
    mode: "get",
  });
});

Deno.test("порча: ссылка одноразовая — второй проход тем же токеном не заводит ключ", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  assertEquals(await enrollPhone(deps, token, await SoftAuthenticator.create()), { ok: true });
  const again = await enrollPhone(deps, token, await SoftAuthenticator.create());
  assertEquals(again.ok, false);
  assertEquals(store.keys.length, 2);
});

Deno.test("порча: ответ, сохранённый с первого прохода, повторно не принимается", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  const s = await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token });
  assert(s.ok);
  const phone = await SoftAuthenticator.create();
  const cred = await phone.register({ challenge: s.options.challenge as string, origin: ORIGIN, rpID: RP_ID });
  const input = { telegramId: ANNA, origin: ORIGIN, token, name: "Safari · iPhone", credential: cred };
  assertEquals(await finishEnrollment(deps, input), { ok: true });
  await store.deleteOwn(ANNA, store.keys[1].id);
  assertEquals(await finishEnrollment(deps, input), { ok: false, reason: "failed" });
  assertEquals(store.keys.length, 1);
});

Deno.test("порча: сессия другого человека ссылку не использует, а ссылка цела для хозяина", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  const boris = await enrollPhone(deps, token, await SoftAuthenticator.create(), BORIS);
  assertEquals(boris.ok, false);
  assertEquals(store.keys.filter((k) => k.telegramId === BORIS).length, 0);
  assertEquals(await enrollPhone(deps, token, await SoftAuthenticator.create()), { ok: true });
});

Deno.test("порча: Борис не дозаводит ключ по вызову, взведённому ссылкой Анны", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  const s = await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token });
  assert(s.ok);
  const cred = await (await SoftAuthenticator.create()).register({
    challenge: s.options.challenge as string,
    origin: ORIGIN,
    rpID: RP_ID,
  });
  assertEquals(
    await finishEnrollment(deps, { telegramId: BORIS, origin: ORIGIN, token, name: "x", credential: cred }),
    { ok: false, reason: "failed" },
  );
  assertEquals(store.keys.length, 1);
});

Deno.test("порча: просроченная ссылка (10 минут) не открывает регистрацию", async () => {
  const { deps, store, advance } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  advance(DEVICE_LINK_TTL_MS + 1);
  assertEquals(
    await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(store.keys.length, 1);
});

Deno.test("просроченный вызов регистрации (2 минуты) не принимается, хотя ссылка жива", async () => {
  const { deps, store, advance } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  const s = await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token });
  assert(s.ok);
  const cred = await (await SoftAuthenticator.create()).register({
    challenge: s.options.challenge as string,
    origin: ORIGIN,
    rpID: RP_ID,
  });
  advance(2 * 60 * 1000 + 1);
  assertEquals(
    await finishEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, token, name: "x", credential: cred }),
    { ok: false, reason: "failed" },
  );
  assertEquals(store.keys.length, 1);
});

Deno.test("новая ссылка гасит прежнюю", async () => {
  const { deps } = setup();
  await annaWithMac(deps);
  const first = await link(deps);
  const second = await link(deps);
  assertEquals((await enrollPhone(deps, first, await SoftAuthenticator.create())).ok, false);
  assertEquals(await enrollPhone(deps, second, await SoftAuthenticator.create()), { ok: true });
});

Deno.test("лимит выдачи: не больше 5 ссылок в час", async () => {
  const { deps, advance } = setup();
  await annaWithMac(deps);
  for (let i = 0; i < MAX_DEVICE_LINKS_PER_WINDOW; i++) await link(deps);
  assertEquals(await issueDeviceLink(deps, { telegramId: ANNA, secondStepDone: true }), {
    ok: false,
    reason: "throttled",
  });
  advance(60 * 60 * 1000 + 1);
  assert((await issueDeviceLink(deps, { telegramId: ANNA, secondStepDone: true })).ok);
});

Deno.test("мусор вместо токена и чужой origin — отказ без обращения к ссылкам", async () => {
  const { deps } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  assertEquals(
    await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token: "nope" }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(
    await startEnrollment(deps, { telegramId: ANNA, origin: "https://evil.example", userName: "anna", token }),
    { ok: false, reason: "origin" },
  );
  assertEquals(await enrollPhone(deps, token, await SoftAuthenticator.create()), { ok: true });
});

Deno.test("без проверки пользователя (UV) телефон ключ не заводит, ссылка потрачена", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const token = await link(deps);
  const s = await startEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, userName: "anna", token });
  assert(s.ok);
  const cred = await (await SoftAuthenticator.create()).register({
    challenge: s.options.challenge as string,
    origin: ORIGIN,
    rpID: RP_ID,
    userVerified: false,
  });
  assertEquals(
    await finishEnrollment(deps, { telegramId: ANNA, origin: ORIGIN, token, name: "x", credential: cred }),
    { ok: false, reason: "failed" },
  );
  assertEquals(store.keys.length, 1);
});

Deno.test("демо ссылок не получает и не использует", async () => {
  const { deps } = setup();
  const { DEMO_USER_ID } = await import("../demo-session.ts");
  assertEquals(await issueDeviceLink(deps, { telegramId: DEMO_USER_ID, secondStepDone: true }), {
    ok: false,
    reason: "not_applicable",
  });
});

Deno.test("свой ключ удаляется, чужой — нет", async () => {
  const { deps, store } = setup();
  await annaWithMac(deps);
  const id = store.keys[0].id;
  assertEquals(await store.deleteOwn(BORIS, id), false);
  assertEquals(await store.deleteOwn(ANNA, id), true);
  assertEquals(store.keys.length, 0);
});
