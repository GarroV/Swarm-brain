import { assertEquals } from "@std/assert";
import {
  chatGptConnectionStatus,
  type McpOAuthConnection,
  safeOAuthRedirect,
} from "./mcp-oauth.ts";

const now = new Date("2026-10-30T12:00:00Z");
const grant = (over: Partial<McpOAuthConnection> = {}): McpOAuthConnection => ({
  id: "grant",
  clientName: "ChatGPT",
  clientKind: "chatgpt",
  createdAt: "2026-10-30T10:00:00Z",
  lastSeenAt: null,
  expiresAt: "2026-11-29T12:00:00Z",
  ...over,
});

Deno.test("ChatGPT: another client and expired grants do not make it connected", () => {
  assertEquals(
    chatGptConnectionStatus([
      grant({ clientKind: "other", clientName: "ChatGPT" }),
      grant({
        expiresAt: "2026-10-29T12:00:00Z",
        lastSeenAt: "2026-10-29T11:00:00Z",
      }),
    ], now),
    { active: false, lastSeenAt: null, expiresAt: null },
  );
});

Deno.test("ChatGPT: a new grant is awaiting its first request, not connected", () => {
  assertEquals(chatGptConnectionStatus([grant()], now), {
    active: true,
    lastSeenAt: null,
    expiresAt: "2026-11-29T12:00:00Z",
  });
});

Deno.test("ChatGPT: last request comes only from its own active grants", () => {
  assertEquals(
    chatGptConnectionStatus([
      grant({ id: "first", lastSeenAt: "2026-10-30T10:00:00Z" }),
      grant({ id: "second", lastSeenAt: "2026-10-30T11:00:00Z" }),
      grant({ clientKind: "other", lastSeenAt: "2026-10-30T12:00:00Z" }),
    ], now).lastSeenAt,
    "2026-10-30T11:00:00Z",
  );
});

Deno.test("OAuth redirects permit HTTPS and native loopback callbacks", () => {
  for (
    const url of [
      "https://chatgpt.com/connector/oauth/id?code=example",
      "http://127.0.0.1:8080/callback",
      "http://[::1]:8080/callback",
    ]
  ) {
    assertEquals(safeOAuthRedirect(url), true, url);
  }
  for (
    const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "//chatgpt.com",
      "http://chatgpt.com/callback",
      "https://user:password@chatgpt.com/callback",
      "http://localhost.evil.example/callback",
    ]
  ) {
    assertEquals(safeOAuthRedirect(url), false, url);
  }
});
