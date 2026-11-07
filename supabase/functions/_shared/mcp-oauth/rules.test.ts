import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientKind, normalizeScope, pkceChallenge, validateRegistration, validRedirectUri } from "./rules.ts";

Deno.test("OAuth redirects: exact HTTPS or loopback HTTP only, no credentials/fragments", () => {
  for (
    const uri of [
      "https://chatgpt.com/connector/oauth/abc",
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://chat.openai.com/aip/g-1/oauth/callback",
      "http://127.0.0.1:1234/callback",
      "http://localhost:8080/cb",
      "http://[::1]:9000/cb",
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
      "https://example.com/callback",
      "https://chatgpt.com.evil.com/callback",
      "https://evil.com/https://chatgpt.com/cb",
      "https://chatgpt.com@evil.com/cb",
      "https://evil.com@chatgpt.com/cb",
      "https://sub.chatgpt.com/cb",
      "https://claude.ai:8443/cb",
      "http://chatgpt.com/cb",
      "http://claude.ai/cb",
      "https://localhost/cb",
      "ftp://claude.ai/cb",
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
    validateRegistration({ client_name: "ChatGPT", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })
      .clientName,
    "ChatGPT",
  );
  assertEquals(clientKind(["https://example.com/callback"]), "other");
  assertEquals(clientKind(["https://chatgpt.com.evil/callback"]), "other");
  assertEquals(clientKind(["https://chatgpt.com/connector/oauth/cb"]), "chatgpt");
  assertThrows(() => validateRegistration({ redirect_uris: [], token_endpoint_auth_method: "none" }));
  assertThrows(() =>
    validateRegistration({ redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "client_secret_basic" })
  );
});

Deno.test("OAuth registration refuses any callback outside the allowed list, even mixed with allowed ones", () => {
  assertThrows(() => validateRegistration({ redirect_uris: ["https://evil.example/cb"] }));
  assertThrows(() =>
    validateRegistration({ redirect_uris: ["https://chatgpt.com/connector/oauth/a", "https://evil.example/cb"] })
  );
  assertEquals(
    validateRegistration({ redirect_uris: ["https://chatgpt.com/connector/oauth/a", "http://127.0.0.1:5/cb"] })
      .redirectUris.length,
    2,
  );
});
