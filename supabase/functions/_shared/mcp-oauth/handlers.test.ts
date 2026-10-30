import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleOAuthAccountRoute } from "./account.ts";
import { authorizationMetadata, type OAuthConfig, protectedResourceMetadata } from "./config.ts";
import type { OAuthDb } from "./db.ts";
import { handleOAuthPublicRequest } from "./public.ts";
import { boundedBody, MAX_BODY_BYTES, OAuthError } from "./rules.ts";

const config: OAuthConfig = {
  issuer: "https://swarm.example",
  webBaseUrl: "https://swarm.example",
  resource: "https://api.example/functions/v1/swarm-mcp",
};
// Deliberately has no DB methods: discovery and rejection of weak sessions must not query it.
const unusedDb = {} as OAuthDb;

Deno.test("OAuth discovery has one canonical issuer/resource and PKCE, never announces unsupported CIMD", async () => {
  const metadata = authorizationMetadata(config);
  assertEquals(metadata.issuer, config.issuer);
  assertEquals(metadata.authorization_response_iss_parameter_supported, true);
  assertEquals(metadata.code_challenge_methods_supported, ["S256"]);
  assertEquals(metadata.token_endpoint_auth_methods_supported, ["none"]);
  assertEquals(metadata.client_id_metadata_document_supported, undefined);
  assertEquals(protectedResourceMetadata(config).authorization_servers, [config.issuer]);
  for (
    const path of [
      "/.well-known/oauth-authorization-server",
      "/functions/v1/swarm-oauth/.well-known/oauth-authorization-server",
    ]
  ) {
    const response = await handleOAuthPublicRequest(unusedDb, new Request(`https://internal.example${path}`), config);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals((await response.json()).issuer, config.issuer);
  }
});

Deno.test("OAuth account routes refuse demo and non-renewable web exchange tokens before touching DB", async () => {
  for (
    const account of [
      { telegramId: 123, groupId: "test", isDemo: true, renewableSession: true },
      { telegramId: 123, groupId: "test", isDemo: false, renewableSession: false },
    ]
  ) {
    const response = await handleOAuthAccountRoute(
      unusedDb,
      new Request("https://swarm.example/mcp/connections"),
      "/mcp/connections",
      account,
      config,
    );
    assertEquals(response?.status, 403);
    assertEquals((await response!.json()).code, "access_denied");
  }
  assertEquals(
    await handleOAuthAccountRoute(unusedDb, new Request("https://swarm.example/other"), "/other", {
      telegramId: 123,
      groupId: "test",
      isDemo: false,
      renewableSession: true,
    }, config),
    null,
  );
});

Deno.test("OAuth HTTP endpoints refuse wrong methods without executing registration or exchange", async () => {
  const response = await handleOAuthPublicRequest(unusedDb, new Request("https://swarm.example/oauth/token"), config);
  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Allow"), "POST, OPTIONS");
  const missing = await handleOAuthPublicRequest(unusedDb, new Request("https://swarm.example/unknown"), config);
  assertEquals(missing.status, 404);
});

Deno.test("OAuth bounded reader rejects declared and streamed oversize bodies", async () => {
  const requests = [
    new Request("https://swarm.example/oauth/register", {
      method: "POST",
      headers: { "Content-Length": String(MAX_BODY_BYTES + 1) },
      body: "{}",
    }),
    new Request("https://swarm.example/oauth/register", { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1) }),
  ];
  for (const request of requests) {
    let status = 0;
    try {
      await boundedBody(request);
    } catch (error) {
      if (error instanceof OAuthError) status = error.status;
    }
    assertEquals(status, 413);
  }
});

function registrationDb(found = true): OAuthDb {
  return {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              error: null,
              data: found
                ? {
                  client_id: "test-client",
                  client_name: "Test",
                  redirect_uris: ["https://chatgpt.com/connector/oauth/qa"],
                }
                : null,
            }),
        }),
      }),
    }),
  } as unknown as OAuthDb;
}

Deno.test("OAuth authorize errors return to a verified callback with original state and issuer", async () => {
  for (
    const [extra, expectedError] of [
      [{ scope: "mcp unexpected" }, "invalid_scope"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ resource: "https://other.example/mcp" }, "invalid_target"],
    ] as const
  ) {
    const params = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://chatgpt.com/connector/oauth/qa",
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
      resource: config.resource,
      scope: "mcp",
      state: "expected-state",
      ...extra,
    });
    const response = await handleOAuthPublicRequest(
      registrationDb(),
      new Request(`${config.issuer}/oauth/authorize?${params}`),
      config,
    );
    assertEquals(response.status, 302);
    const target = new URL(response.headers.get("Location")!);
    assertEquals(target.origin, "https://chatgpt.com");
    assertEquals(target.pathname, "/connector/oauth/qa");
    assertEquals(target.searchParams.get("error"), expectedError);
    assertEquals(target.searchParams.get("state"), "expected-state");
    assertEquals(target.searchParams.get("iss"), config.issuer);
    assertEquals(target.searchParams.has("code"), false);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  }
});

Deno.test("OAuth authorize never redirects errors to an unknown client or unregistered callback", async () => {
  for (
    const [found, callback] of [[false, "https://chatgpt.com/connector/oauth/qa"], [
      true,
      "https://attacker.example/callback",
    ]] as const
  ) {
    const params = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: callback,
      scope: "mcp unexpected",
      state: "expected-state",
    });
    const response = await handleOAuthPublicRequest(
      registrationDb(found),
      new Request(`${config.issuer}/oauth/authorize?${params}`),
      config,
    );
    assertEquals(response.status, 400);
    assertEquals(response.headers.get("Location"), null);
  }
});
