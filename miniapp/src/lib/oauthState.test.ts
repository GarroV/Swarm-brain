// state Google-OAuth на CF Pages (`miniapp/functions/_lib/oauth-state.ts`): принимается только
// свой, свежий и из того же браузера (кука с одноразовым значением), и не путается с сессией.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newNonce, signState, STATE_TTL_SEC, verifyState } from "../../functions/_lib/oauth-state.ts";
import { signJWT, verifyJWT } from "../../functions/_lib/jwt.ts";

const SECRET = "state-secret";

Deno.test("свой state с той же кукой принимается, next сохраняется", async () => {
  const nonce = newNonce();
  const st = await signState(SECRET, { flow: "login", next: "/live?m=1", nonce });
  assertEquals(await verifyState(SECRET, st, nonce), { flow: "login", next: "/live?m=1", tid: null });
});

Deno.test("state без куки или с чужой кукой отклоняется", async () => {
  const nonce = newNonce();
  const st = await signState(SECRET, { flow: "login", next: "/", nonce });
  assertEquals(await verifyState(SECRET, st, null), null);
  assertEquals(await verifyState(SECRET, st, ""), null);
  assertEquals(await verifyState(SECRET, st, newNonce()), null);
});

Deno.test("одноразовые значения не повторяются", () => {
  assertNotEquals(newNonce(), newNonce());
});

Deno.test("state с чужим ключом или подправленный отклоняется", async () => {
  const nonce = newNonce();
  const st = await signState(SECRET, { flow: "calendar", next: "/", nonce, tid: 5 });
  assertEquals(await verifyState("other", st, nonce), null);
  const [body, sig] = st.split(".");
  const forged = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - body.length % 4) % 4)));
  forged.t = 6;
  const forgedBody = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyState(SECRET, `${forgedBody}.${sig}`, nonce), null);
});

Deno.test("просроченный state отклоняется", async () => {
  const nonce = newNonce();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - (STATE_TTL_SEC + 5) * 1000;
    const st = await signState(SECRET, { flow: "login", next: "/", nonce });
    Date.now = realNow;
    assertEquals(await verifyState(SECRET, st, nonce), null);
  } finally {
    Date.now = realNow;
  }
});

Deno.test("календарный state несёт человека; без него — отказ", async () => {
  const nonce = newNonce();
  const ok = await signState(SECRET, { flow: "calendar", next: "/", nonce, tid: 42 });
  assertEquals((await verifyState(SECRET, ok, nonce))?.tid, 42);
  const noTid = await signState(SECRET, { flow: "calendar", next: "/", nonce });
  assertEquals(await verifyState(SECRET, noTid, nonce), null);
});

Deno.test("open-redirect в next срезается до /", async () => {
  const nonce = newNonce();
  for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
    const st = await signState(SECRET, { flow: "login", next, nonce });
    assertEquals((await verifyState(SECRET, st, nonce))?.next, "/");
  }
});

Deno.test("state не принимается как сессия, сессия — как state", async () => {
  const nonce = newNonce();
  const st = await signState(SECRET, { flow: "calendar", next: "/", nonce, tid: 5 });
  assertEquals(await verifyJWT(st, SECRET), null);
  const session = await signJWT({ telegram_id: 5 }, SECRET);
  assertEquals(await verifyState(SECRET, session, nonce), null);
});
