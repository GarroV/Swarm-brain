import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { signJWT, verifyJWT, shouldRefreshSession, SESSION_TTL_SEC, SESSION_REFRESH_AFTER_SEC } from "./jwt.ts";

const SECRET = "test-secret-0123456789";

Deno.test("signJWT → verifyJWT round-trip возвращает telegram_id и exp", async () => {
  const before = Math.floor(Date.now() / 1000);
  const token = await signJWT({ telegram_id: 744230399 }, SECRET);
  const v = await verifyJWT(token, SECRET);
  assertEquals(v?.telegram_id, 744230399);
  // exp ставится от «сейчас» на полный срок сессии — с запасом на секунду выполнения.
  assertEquals(v!.exp >= before + SESSION_TTL_SEC, true);
  assertEquals(v!.exp <= before + SESSION_TTL_SEC + 5, true);
});

Deno.test("verifyJWT отклоняет подделанную подпись", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET);
  const tampered = token.slice(0, -3) + "AAA";
  assertEquals(await verifyJWT(tampered, SECRET), null);
});

Deno.test("verifyJWT отклоняет чужой секрет", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET);
  assertEquals(await verifyJWT(token, "other-secret"), null);
});

Deno.test("verifyJWT отклоняет протухший токен", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET, -10); // exp в прошлом
  assertEquals(await verifyJWT(token, SECRET), null);
});

Deno.test("verifyJWT отклоняет мусор", async () => {
  assertEquals(await verifyJWT("not.a.jwt", SECRET), null);
  assertEquals(await verifyJWT("", SECRET), null);
});

// ── Продление сессии (issue #50) ───────────────────────────────────────────────
// Раньше сессия жила 7 дней от входа и не продлевалась ничем: тот, кто заходил каждый
// день, всё равно вылетал раз в неделю. Теперь окно скользит, пока человек работает.

const NOW = 1_800_000_000;

Deno.test("shouldRefreshSession: свежую cookie не переиздаём", () => {
  const exp = NOW + SESSION_TTL_SEC; // только что выдана
  assertEquals(shouldRefreshSession(exp, NOW), false);
});

Deno.test("shouldRefreshSession: за минуту до порога — ещё нет, после — да", () => {
  const justUnder = NOW + SESSION_TTL_SEC - SESSION_REFRESH_AFTER_SEC + 60;
  const justOver = NOW + SESSION_TTL_SEC - SESSION_REFRESH_AFTER_SEC - 60;
  assertEquals(shouldRefreshSession(justUnder, NOW), false);
  assertEquals(shouldRefreshSession(justOver, NOW), true);
});

Deno.test("shouldRefreshSession: cookie старше суток переиздаём", () => {
  const exp = NOW + SESSION_TTL_SEC - 2 * 86400; // выдана два дня назад
  assertEquals(shouldRefreshSession(exp, NOW), true);
});

Deno.test("shouldRefreshSession: старая 7-дневная сессия переезжает на новое окно, а не обрывается", () => {
  // Токен, подписанный до перехода на 30 дней: exp близко, issuedAt по новой формуле
  // уезжает в прошлое — значит переиздаём при первом же запросе.
  const legacyExp = NOW + 7 * 86400;
  assertEquals(shouldRefreshSession(legacyExp, NOW), true);
});

Deno.test("shouldRefreshSession: срок сессии — 30 дней", () => {
  assertEquals(SESSION_TTL_SEC, 30 * 86400);
  assertEquals(SESSION_REFRESH_AFTER_SEC, 86400);
});
