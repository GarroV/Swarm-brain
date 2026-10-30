import { assertEquals } from "@std/assert";
import {
  mcpMutationAllowed,
  proxyMcpOAuth,
} from "../../functions/_lib/mcp-oauth-proxy.ts";

Deno.test("OAuth consent and disconnect reject cross-origin or missing-origin cookie requests", () => {
  for (const method of ["POST", "DELETE"]) {
    const url = "https://swarm.example/api/mcp/oauth/authorize";
    assertEquals(mcpMutationAllowed(new Request(url, { method })), false);
    assertEquals(
      mcpMutationAllowed(
        new Request(url, {
          method,
          headers: { Origin: "https://attacker.example" },
        }),
      ),
      false,
    );
    assertEquals(
      mcpMutationAllowed(
        new Request(url, {
          method,
          headers: { Origin: "https://swarm.example" },
        }),
      ),
      true,
    );
    assertEquals(
      mcpMutationAllowed(
        new Request(url, {
          method,
          headers: {
            Origin: "https://swarm.example",
            "Sec-Fetch-Site": "cross-site",
          },
        }),
      ),
      false,
    );
  }
  assertEquals(
    mcpMutationAllowed(
      new Request("https://swarm.example/api/mcp/connections"),
    ),
    true,
  );
});

Deno.test("public OAuth proxy strips web credentials and follows no callback redirect", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (input, init) => {
    called = true;
    assertEquals(
      String(input),
      "https://api.example/functions/v1/swarm-oauth/oauth/token",
    );
    assertEquals(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assertEquals(headers.has("Cookie"), false);
    assertEquals(headers.has("Authorization"), false);
    return Promise.resolve(
      new Response("token", {
        headers: { "Set-Cookie": "should-not-leak=1" },
      }),
    );
  };
  try {
    const response = await proxyMcpOAuth(
      new Request("https://swarm.example/oauth/token", {
        method: "POST",
        body: "grant_type=authorization_code",
        headers: {
          Cookie: "roj_session=private",
          Authorization: "Bearer private",
        },
      }),
      { SWARM_API_URL: "https://api.example/functions/v1/swarm-api" },
    );
    assertEquals(called, true);
    assertEquals(response.headers.has("Set-Cookie"), false);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(await response.text(), "token");
    const rejected = await proxyMcpOAuth(
      new Request("https://swarm.example/oauth/consent"),
      {},
    );
    assertEquals(rejected.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
