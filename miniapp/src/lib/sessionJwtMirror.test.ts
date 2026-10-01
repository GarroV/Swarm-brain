// Копия `miniapp/functions/_lib/jwt.ts` (CF Pages) обязана совпадать с каноном
// `supabase/functions/_shared/jwt.ts`: сессию подписывает Pages, а проверяет swarm-api.
// Расхождение ломает вход у всех или ослабляет проверку с одной стороны — тест держит обе.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as mirror from "../../functions/_lib/jwt.ts";
import * as canon from "../../../supabase/functions/_shared/jwt.ts";

const SECRET = "mirror-secret";

Deno.test("сессия Pages принимается swarm-api и наоборот", async () => {
  const fromPages = await mirror.signJWT({ telegram_id: 7 }, SECRET);
  const fromApi = await canon.signJWT({ telegram_id: 7 }, SECRET);
  assertEquals((await canon.verifyJWT(fromPages, SECRET))?.telegram_id, 7);
  assertEquals((await mirror.verifyJWT(fromApi, SECRET))?.telegram_id, 7);
});

Deno.test("константы и правила отзыва/продления совпадают", () => {
  assertEquals(mirror.SESSION_PURPOSE, canon.SESSION_PURPOSE);
  assertEquals(mirror.LEGACY_MIN_REMAINING_SEC, canon.LEGACY_MIN_REMAINING_SEC);
  assertEquals(mirror.SESSION_TTL_SEC, canon.SESSION_TTL_SEC);
  const claims = { telegram_id: 1, exp: 2_000_000_000, authTime: null, legacy: true };
  assertEquals(mirror.authTimeForRefresh(claims), canon.authTimeForRefresh(claims));
  const cases = [[null, "2026-10-01T00:00:00Z"], [5, null], [5, "bad"], [5, "2026-10-01T00:00:00Z"], [9_999_999_999, "2026-10-01T00:00:00Z"]] as const;
  for (const [t, r] of cases) {
    assertEquals(mirror.isSessionRevoked({ authTime: t }, r), canon.isSessionRevoked({ authTime: t }, r));
  }
});

async function signRaw(body: Record<string, unknown>): Promise<string> {
  const e = new TextEncoder();
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const data = `${b64(e.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${b64(e.encode(JSON.stringify(body)))}`;
  const key = await crypto.subtle.importKey("raw", e.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${data}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, e.encode(data))))}`;
}

Deno.test("обе копии отклоняют не-сессию и короткий старый формат", async () => {
  const now = Math.floor(Date.now() / 1000);
  const foreign = await signRaw({ telegram_id: 5, pur: "other", auth_time: now, exp: now + 3600 });
  const shortLegacy = await signRaw({ telegram_id: 5, exp: now + 60 });
  for (const impl of [mirror, canon]) {
    assertEquals(await impl.verifyJWT(foreign, SECRET), null);
    assertEquals(await impl.verifyJWT(shortLegacy, SECRET), null);
  }
});
