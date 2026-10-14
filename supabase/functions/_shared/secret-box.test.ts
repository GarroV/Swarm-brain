import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { openSecret, sealSecret } from "./secret-box.ts";

const GOOD_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("WORKSPACE_SECRETS_KEY");
  if (value === undefined) Deno.env.delete("WORKSPACE_SECRETS_KEY");
  else Deno.env.set("WORKSPACE_SECRETS_KEY", value);
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("WORKSPACE_SECRETS_KEY");
    else Deno.env.set("WORKSPACE_SECRETS_KEY", prev);
  }
}

Deno.test("secret-box: круг seal → open возвращает исходное, шифротекст не содержит открытого текста", async () => {
  await withKey(GOOD_KEY, async () => {
    const sealed = await sealSecret("sk-test-123456789012345", "cee:openai");
    assertEquals(await openSecret(sealed, "cee:openai"), "sk-test-123456789012345");
    assert(!atob(sealed.ciphertext).includes("sk-test"));
  });
});

Deno.test("secret-box: iv каждый раз новый", async () => {
  await withKey(GOOD_KEY, async () => {
    const a = await sealSecret("same", "cee:openai");
    const b = await sealSecret("same", "cee:openai");
    assertNotEquals(a.iv, b.iv);
    assertNotEquals(a.ciphertext, b.ciphertext);
  });
});

Deno.test("secret-box: подменённый шифротекст не открывается", async () => {
  await withKey(GOOD_KEY, async () => {
    const sealed = await sealSecret("sk-secret", "cee:openai");
    const bytes = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const forged = { ...sealed, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await assertRejects(() => openSecret(forged, "cee:openai"), Error, "не расшифровывается");
  });
});

Deno.test("secret-box: чужой AAD (другое пространство) не открывается", async () => {
  await withKey(GOOD_KEY, async () => {
    const sealed = await sealSecret("sk-secret", "cee:openai");
    await assertRejects(() => openSecret(sealed, "demo:openai"), Error, "не расшифровывается");
  });
});

Deno.test("secret-box: нет ключа шифрования — понятная ошибка, не null", async () => {
  await withKey(undefined, async () => {
    await assertRejects(() => sealSecret("x", "cee:openai"), Error, "WORKSPACE_SECRETS_KEY не задан");
    await assertRejects(
      () => openSecret({ ciphertext: "AA==", iv: "AA==" }, "cee:openai"),
      Error,
      "WORKSPACE_SECRETS_KEY не задан",
    );
  });
});

Deno.test("secret-box: ключ не той длины или не base64 — ошибка", async () => {
  await withKey(btoa("short"), async () => {
    await assertRejects(() => sealSecret("x", "a:b"), Error, "32 байт");
  });
  await withKey("%%% not base64 %%%", async () => {
    await assertRejects(() => sealSecret("x", "a:b"), Error, "не base64");
  });
});
