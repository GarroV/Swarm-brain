import { assertEquals } from "jsr:@std/assert@1";
import { checkTokenRow, TOKEN_EXPIRED_MESSAGE, TOKEN_INVALID_MESSAGE } from "./token-state.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const row = (expires: string | null) => ({ telegram_id: 111, claude_mcp_token_expires_at: expires });

Deno.test("токен со сроком в будущем годен", () => {
  assertEquals(checkTokenRow(row("2026-10-27T12:00:01Z"), NOW), { ok: true, telegramId: 111 });
});

Deno.test("истёкший токен отказан и ведёт в Настройки веба, а не в бота", () => {
  const res = checkTokenRow(row("2026-10-27T11:59:59Z"), NOW);
  assertEquals(res, { ok: false, error: TOKEN_EXPIRED_MESSAGE });
  assertEquals(TOKEN_EXPIRED_MESSAGE.includes("Settings"), true);
  assertEquals(TOKEN_EXPIRED_MESSAGE.includes("/mytoken"), false);
});

Deno.test("срок ровно сейчас — уже не годен", () => {
  assertEquals(checkTokenRow(row("2026-10-27T12:00:00Z"), NOW).ok, false);
});

Deno.test("токен без срока или с нечитаемым сроком не годен (fail-closed)", () => {
  assertEquals(checkTokenRow(row(null), NOW).ok, false);
  assertEquals(checkTokenRow(row("не дата"), NOW).ok, false);
});

Deno.test("хэша нет в базе (отозван) — отказ с подсказкой про Настройки", () => {
  const res = checkTokenRow(null, NOW);
  assertEquals(res, { ok: false, error: TOKEN_INVALID_MESSAGE });
  assertEquals(TOKEN_INVALID_MESSAGE.includes("Settings"), true);
});
