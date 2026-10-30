import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientKind, normalizeScope, pkceChallenge, validateRegistration, validRedirectUri } from "./rules.ts";

Deno.test("OAuth redirects: exact HTTPS or loopback HTTP only, no credentials/fragments", () => {
  for (
    const uri of [
      "https://chatgpt.com/connector/oauth/abc",
      "https://claude.ai/api/mcp/auth_callback",
      "http://127.0.0.1:1234/callback",
    ]
  ) {
    assertEquals(validRedirectUri(uri), true, uri);
  }
  for (
    const uri of [
      "http://attacker.example/callback",
      "https://user:pass@example.com/callback",
      "https://example.com/#token",
      "https://example.com/#",
      "javascript:alert(1)",
      "https://chatgpt.com\n",
      "http://127.0.0.1.evil/callback",
    ]
  ) {
    assertEquals(validRedirectUri(uri), false, uri);
  }
});

Deno.test("PKCE S256 follows RFC 7636 vector and rejects malformed verifier", async () => {
  assertEquals(
    await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  await assertRejects(() => pkceChallenge("short"));
});

Deno.test("OAuth scope cannot silently expand beyond MCP", () => {
  assertEquals(normalizeScope("offline_access mcp mcp"), "mcp offline_access");
  assertEquals(normalizeScope(undefined), "mcp offline_access");
  assertThrows(() => normalizeScope("mcp admin"));
  assertThrows(() => normalizeScope("offline_access"));
});

Deno.test("OAuth registration limits and client kind never trust a claimed name", () => {
  assertEquals(
    validateRegistration({ client_name: "ChatGPT", redirect_uris: ["https://example.com/callback"] }).clientName,
    "ChatGPT",
  );
  assertEquals(clientKind(["https://example.com/callback"]), "other");
  assertEquals(clientKind(["https://chatgpt.com.evil/callback"]), "other");
  assertEquals(clientKind(["https://chatgpt.com/connector/oauth/cb"]), "chatgpt");
  assertThrows(() => validateRegistration({ redirect_uris: [], token_endpoint_auth_method: "none" }));
  assertThrows(() =>
    validateRegistration({ redirect_uris: ["https://example.com"], token_endpoint_auth_method: "client_secret_basic" })
  );
});
