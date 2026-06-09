import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { signJWT, verifyJWT } from "./jwt.ts";

const SECRET = "test-secret-0123456789";

Deno.test("signJWT → verifyJWT round-trip возвращает telegram_id", async () => {
  const token = await signJWT({ telegram_id: 744230399 }, SECRET);
  const v = await verifyJWT(token, SECRET);
  assertEquals(v, { telegram_id: 744230399 });
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
