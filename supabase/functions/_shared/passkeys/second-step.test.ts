import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSecondStepRequired,
  parseSecondStepAudience,
  secondStepBlocks,
  secondStepRequiredFrom,
  secondStepState,
} from "./second-step.ts";
import type { SessionClaims } from "../jwt.ts";

const FULL_TTL = 30 * 86400;
const now = 1_800_000_000;
const login = (secondStep: boolean): SessionClaims => ({
  telegram_id: 5,
  exp: now + FULL_TTL,
  authTime: now,
  legacy: false,
  secondStep,
});
const shortToken: SessionClaims = {
  telegram_id: 5,
  exp: now + 12 * 3600,
  authTime: now,
  legacy: false,
  secondStep: false,
};

Deno.test("настоящий вход без метки: применим, не пройден; с меткой — пройден", () => {
  assertEquals(secondStepState(login(false), { isDemo: false, required: false, audience: "all" }), {
    applies: true,
    done: false,
    required: false,
    required_from: null,
    session: now,
  });
  assertEquals(secondStepState(login(true), { isDemo: false, required: false, audience: "all" }).done, true);
});

Deno.test("демо, Mini App (нет сессии) и короткий токен веб-доступа — шаг не применим", () => {
  assertEquals(secondStepState(login(false), { isDemo: true, required: true, audience: "all" }).applies, false);
  assertEquals(secondStepState(null, { isDemo: false, required: true, audience: "all" }).applies, false);
  assertEquals(secondStepState(shortToken, { isDemo: false, required: true, audience: "all" }).applies, false);
});

Deno.test("замок выключен по умолчанию: ничего не блокируется", () => {
  assertEquals(isSecondStepRequired(undefined), false);
  assertEquals(isSecondStepRequired("0"), false);
  assertEquals(isSecondStepRequired(""), false);
  const st = secondStepState(login(false), {
    isDemo: false,
    required: isSecondStepRequired(undefined),
    audience: "all",
  });
  assertEquals(secondStepBlocks(st, "GET", "/tasks"), false);
});

Deno.test("замок включён: сессия без шага закрыта, кроме /me, выхода и заглушки работ; с шагом — открыта", () => {
  assertEquals(isSecondStepRequired("1"), true);
  const locked = secondStepState(login(false), { isDemo: false, required: true, audience: "all" });
  assertEquals(secondStepBlocks(locked, "GET", "/tasks"), true);
  assertEquals(secondStepBlocks(locked, "POST", "/tasks"), true);
  assertEquals(secondStepBlocks(locked, "PATCH", "/me"), true);
  assertEquals(secondStepBlocks(locked, "GET", "/me"), false);
  assertEquals(secondStepBlocks(locked, "POST", "/auth/revoke-sessions"), false);
  assertEquals(secondStepBlocks(locked, "GET", "/maintenance"), false);
  const done = secondStepState(login(true), { isDemo: false, required: true, audience: "all" });
  assertEquals(secondStepBlocks(done, "GET", "/tasks"), false);
  const demo = secondStepState(login(false), { isDemo: true, required: true, audience: "all" });
  assertEquals(secondStepBlocks(demo, "GET", "/tasks"), false);
});

Deno.test("аудитория: пусто и пробелы — никому; all — всем; список — только им; мусор не значит all", () => {
  assertEquals(parseSecondStepAudience(undefined), "none");
  assertEquals(parseSecondStepAudience(""), "none");
  assertEquals(parseSecondStepAudience("   "), "none");
  assertEquals(parseSecondStepAudience("all"), "all");
  assertEquals(parseSecondStepAudience(" ALL "), "all");
  assertEquals(parseSecondStepAudience("5, 744230399 ,7"), new Set([5, 744230399, 7]));
  assertEquals(parseSecondStepAudience("abc,5,,x1,-3,1.5"), new Set([5]));
  assertEquals(parseSecondStepAudience("abc,true,1"), new Set([1]));
  assertEquals(parseSecondStepAudience("true"), "none");
  assertEquals(parseSecondStepAudience("abc"), "none");
});

Deno.test("аудитория ограничивает применимость; замок не трогает тех, кому шаг не применим", () => {
  const base = { isDemo: false, required: true };
  assertEquals(secondStepState(login(false), { ...base, audience: "none" }).applies, false);
  assertEquals(secondStepState(login(false), { ...base, audience: new Set([6]) }).applies, false);
  assertEquals(secondStepState(login(false), { ...base, audience: new Set([5]) }).applies, true);
  const outside = secondStepState(login(false), { ...base, audience: new Set([6]) });
  assertEquals(secondStepBlocks(outside, "GET", "/tasks"), false);
  const inside = secondStepState(login(false), { ...base, audience: new Set([5]) });
  assertEquals(secondStepBlocks(inside, "GET", "/tasks"), true);
});

// Замок по дате: с 00:00 по Белграду. 26.10.2026 — зимнее время (CET, UTC+1; переход на него 25.10 в 03:00),
// значит начало суток — 25.10 в 23:00 UTC.
const MON_START = Date.parse("2026-10-25T23:00:00Z");

Deno.test("замок по дате: до 00:00 по Белграду выключен, с 00:00 — включён (граница секунда в секунду)", () => {
  const at = (ms: number) => new Date(ms);
  assertEquals(isSecondStepRequired("2026-10-26", at(MON_START - 1)), false);
  assertEquals(isSecondStepRequired("2026-10-26", at(MON_START)), true);
  assertEquals(isSecondStepRequired("2026-10-26", at(MON_START + 7 * 86400_000)), true);
});

Deno.test("замок по дате в летнее время: начало суток по Белграду — UTC+2", () => {
  const start = Date.parse("2026-07-14T22:00:00Z"); // 15.07 00:00 CEST
  assertEquals(isSecondStepRequired("2026-07-15", new Date(start - 1)), false);
  assertEquals(isSecondStepRequired("2026-07-15", new Date(start)), true);
});

Deno.test("формат замка: 1/true — сразу, дата ISO — по дате, пусто и мусор — выключен, битая дата — выключен", () => {
  const now = new Date(MON_START);
  assertEquals(isSecondStepRequired("1", now), true);
  assertEquals(isSecondStepRequired("true", now), true);
  assertEquals(isSecondStepRequired(" 2026-10-26 ", now), true);
  for (
    const bad of [
      undefined,
      "",
      "  ",
      "0",
      "false",
      "yes",
      "2026-13-01",
      "2026-02-30",
      "26.10.2026",
      "2026-10-26T00:00",
      "2026-1-26",
    ]
  ) {
    assertEquals(isSecondStepRequired(bad, new Date(MON_START + 400 * 86400_000)), false, String(bad));
  }
});

Deno.test("required_from: дата только у формата с датой; остальное — null", () => {
  assertEquals(secondStepRequiredFrom("2026-10-26"), "2026-10-26");
  assertEquals(secondStepRequiredFrom(" 2026-10-26 "), "2026-10-26");
  assertEquals(secondStepRequiredFrom("1"), null);
  assertEquals(secondStepRequiredFrom("true"), null);
  assertEquals(secondStepRequiredFrom(undefined), null);
  assertEquals(secondStepRequiredFrom("2026-02-30"), null);
});

Deno.test("состояние отдаёт дату начала; required — вычисленное на сейчас", () => {
  const before = secondStepState(login(false), {
    isDemo: false,
    required: isSecondStepRequired("2026-10-26", new Date(MON_START - 1)),
    requiredFrom: secondStepRequiredFrom("2026-10-26"),
    audience: "all",
  });
  assertEquals(before.required, false);
  assertEquals(before.required_from, "2026-10-26");
  assertEquals(secondStepBlocks(before, "GET", "/tasks"), false);
  const after = secondStepState(login(false), {
    isDemo: false,
    required: isSecondStepRequired("2026-10-26", new Date(MON_START)),
    requiredFrom: secondStepRequiredFrom("2026-10-26"),
    audience: "all",
  });
  assertEquals(after.required, true);
  assertEquals(secondStepBlocks(after, "GET", "/tasks"), true);
});

Deno.test("первая привязка под замком: человеку без ключа остаётся открытым /me — через него Pages-функции пускают к окну ключа", () => {
  // Привязка идёт Pages-функциями /api/auth/passkey/* → auth-passkey по HMAC, мимо swarm-api; единственное,
  // что они спрашивают у swarm-api под сессией человека, — GET /me (miniapp/functions/_lib/passkey-call.ts).
  const locked = secondStepState(login(false), { isDemo: false, required: true, audience: "all" });
  assertEquals(secondStepBlocks(locked, "GET", "/me"), false);
  assertEquals(secondStepBlocks(locked, "POST", "/auth/revoke-sessions"), false);
});
