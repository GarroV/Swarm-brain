import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { oauthUnauthorized } from "./http-auth.ts";

Deno.test("OAuth 401 tells clients how to discover login and is never cached", async () => {
  const response = oauthUnauthorized(7, "https://swarm.example/.well-known/oauth-protected-resource");
  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("WWW-Authenticate"),
    'Bearer resource_metadata="https://swarm.example/.well-known/oauth-protected-resource"',
  );
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assertEquals(body.id, 7);
  assertEquals(body.error.code, -32001);
});
