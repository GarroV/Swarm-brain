import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyToken, type TokenRow } from "./agent-auth.ts";

const HOUR = 3600_000;
const now = Date.parse("2026-08-28T09:00:00Z");
const future = new Date(now + 24 * HOUR).toISOString();
const past = new Date(now - HOUR).toISOString();

const row = (over: Partial<TokenRow> = {}): TokenRow => ({
  claude_mcp_token_hash: "mcp", claude_mcp_token_expires_at: future,
  recorder_token_hash: "new", recorder_token_expires_at: future,
  recorder_token_prev_hash: null, recorder_token_prev_expires_at: null,
  ...over,
});

Deno.test("текущий токен рекордера принимается", () => {
  assertEquals(classifyToken("new", row(), now), { kind: "recorder", expired: false });
});

Deno.test("предыдущий токен работает, пока держится перекрытие", () => {
  const r = row({ recorder_token_prev_hash: "old", recorder_token_prev_expires_at: future });
  assertEquals(classifyToken("old", r, now), { kind: "recorder_prev", expired: false });
});

Deno.test("истёкшее перекрытие больше не пускает", () => {
  const r = row({ recorder_token_prev_hash: "old", recorder_token_prev_expires_at: past });
  assertEquals(classifyToken("old", r, now), { kind: "recorder_prev", expired: true });
});

Deno.test("перекрытие снято — прежний токен чужой", () => {
  assertEquals(classifyToken("old", row(), now), { kind: "none", expired: false });
});

Deno.test("MCP-токен Claude Desktop по-прежнему принимается", () => {
  assertEquals(classifyToken("mcp", row(), now), { kind: "mcp", expired: false });
});

Deno.test("истёкший основной токен рекордера отбивается", () => {
  assertEquals(classifyToken("new", row({ recorder_token_expires_at: past }), now),
    { kind: "recorder", expired: true });
});

Deno.test("чужой хэш не проходит", () => {
  assertEquals(classifyToken("stranger", row(), now), { kind: "none", expired: false });
});
