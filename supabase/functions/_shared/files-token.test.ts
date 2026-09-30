import { assertEquals } from "@std/assert";
import { type FileClaims, importSigningKey, importVerifyKey, signFileToken, verifyFileToken } from "./files-token.ts";

const K = "0b8e7c4e-2f1a-4c3d-9e8f-123456789abc";
const NOW = 1_800_000_000;

async function keypair(): Promise<{ priv: string; pub: string }> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    priv: b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)),
    pub: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
  };
}

const put: FileClaims = {
  k: K,
  op: "put",
  exp: NOW + 300,
  max: 50 * 1024 * 1024,
};

Deno.test("files-token: подписанная ссылка проходит проверку и отдаёт условия", async () => {
  const { priv, pub } = await keypair();
  const token = await signFileToken(await importSigningKey(priv), put);
  const r = await verifyFileToken(
    await importVerifyKey(pub),
    token,
    "put",
    K,
    NOW,
  );
  assertEquals(r, { ok: true, claims: put });
});

Deno.test("files-token: ссылка, подписанная чужим ключом, — отказ", async () => {
  const a = await keypair();
  const b = await keypair();
  const token = await signFileToken(await importSigningKey(a.priv), put);
  const r = await verifyFileToken(
    await importVerifyKey(b.pub),
    token,
    "put",
    K,
    NOW,
  );
  assertEquals(r, { ok: false, reason: "bad signature" });
});

Deno.test("files-token: подмена условий после подписи (больший лимит) — отказ", async () => {
  const { priv, pub } = await keypair();
  const token = await signFileToken(await importSigningKey(priv), put);
  const forged = btoa(JSON.stringify({ ...put, max: 10 * 1024 ** 3 })).replace(
    /=+$/,
    "",
  )
    .replace(/\+/g, "-").replace(/\//g, "_");
  const r = await verifyFileToken(
    await importVerifyKey(pub),
    `${forged}.${token.split(".")[1]}`,
    "put",
    K,
    NOW,
  );
  assertEquals(r, { ok: false, reason: "bad signature" });
});

Deno.test("files-token: истёкшая ссылка — отказ", async () => {
  const { priv, pub } = await keypair();
  const token = await signFileToken(await importSigningKey(priv), put);
  const r = await verifyFileToken(
    await importVerifyKey(pub),
    token,
    "put",
    K,
    NOW + 301,
  );
  assertEquals(r, { ok: false, reason: "expired" });
});

Deno.test("files-token: ссылка на скачивание не годится для загрузки и для другого файла", async () => {
  const { priv, pub } = await keypair();
  const verify = await importVerifyKey(pub);
  const token = await signFileToken(await importSigningKey(priv), {
    k: K,
    op: "get",
    exp: NOW + 60,
  });
  assertEquals(await verifyFileToken(verify, token, "put", K, NOW), {
    ok: false,
    reason: "wrong op",
  });
  const other = "11111111-2222-4333-8444-555555555555";
  assertEquals(await verifyFileToken(verify, token, "get", other, NOW), {
    ok: false,
    reason: "wrong object",
  });
});

Deno.test("files-token: загрузка без лимита размера не принимается", async () => {
  const { priv, pub } = await keypair();
  const token = await signFileToken(await importSigningKey(priv), {
    k: K,
    op: "put",
    exp: NOW + 60,
  });
  const r = await verifyFileToken(
    await importVerifyKey(pub),
    token,
    "put",
    K,
    NOW,
  );
  assertEquals(r, { ok: false, reason: "no size limit" });
});

Deno.test("files-token: мусор вместо ссылки — отказ, а не исключение", async () => {
  const { pub } = await keypair();
  const verify = await importVerifyKey(pub);
  for (const junk of ["", "abc", "a.b.c", "@@@.###"]) {
    const r = await verifyFileToken(verify, junk, "get", K, NOW);
    assertEquals(r.ok, false, junk);
  }
});
