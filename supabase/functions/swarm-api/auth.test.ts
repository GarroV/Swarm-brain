import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { verifyInitData } from "./auth.ts";

const BOT_TOKEN = "123456:TEST_TOKEN_abcdef";

// Build a valid initData string using the same algorithm the verifier expects.
async function signInitData(
  fields: Record<string, string>,
): Promise<string> {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", webAppKey, enc.encode(BOT_TOKEN));
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hashBytes = await crypto.subtle.sign("HMAC", secretKey, enc.encode(dataCheckString));
  const hash = Array.from(new Uint8Array(hashBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const nowSec = () => Math.floor(Date.now() / 1000);

Deno.test("verifyInitData — accepts a freshly signed payload", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec()),
    user: JSON.stringify({ id: 744230399, language_code: "ru" }),
  });
  const result = await verifyInitData(initData, BOT_TOKEN, 3600);
  assertNotEquals(result, null);
  assertEquals(result?.telegram_id, 744230399);
  assertEquals(result?.language_code, "ru");
});

Deno.test("verifyInitData — rejects a tampered hash", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec()),
    user: JSON.stringify({ id: 1 }),
  });
  const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
  assertEquals(await verifyInitData(tampered, BOT_TOKEN, 3600), null);
});

Deno.test("verifyInitData — rejects when payload field is mutated after signing", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec()),
    user: JSON.stringify({ id: 111 }),
  });
  // Swap the user id but keep the original hash — must fail
  const forged = initData.replace("%22id%22%3A111", "%22id%22%3A999");
  assertEquals(await verifyInitData(forged, BOT_TOKEN, 3600), null);
});

Deno.test("verifyInitData — rejects a stale auth_date", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec() - 7200), // 2h old
    user: JSON.stringify({ id: 1 }),
  });
  assertEquals(await verifyInitData(initData, BOT_TOKEN, 3600), null);
});

Deno.test("verifyInitData — rejects wrong bot token", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec()),
    user: JSON.stringify({ id: 1 }),
  });
  assertEquals(await verifyInitData(initData, "999999:OTHER_TOKEN", 3600), null);
});

Deno.test("verifyInitData — rejects missing hash", async () => {
  assertEquals(await verifyInitData("auth_date=123&user=%7B%7D", BOT_TOKEN, 3600), null);
});

Deno.test("verifyInitData — rejects missing user", async () => {
  const initData = await signInitData({ auth_date: String(nowSec()) });
  assertEquals(await verifyInitData(initData, BOT_TOKEN, 3600), null);
});

Deno.test("verifyInitData — rejects malformed user JSON", async () => {
  const initData = await signInitData({
    auth_date: String(nowSec()),
    user: "not-json",
  });
  assertEquals(await verifyInitData(initData, BOT_TOKEN, 3600), null);
});
