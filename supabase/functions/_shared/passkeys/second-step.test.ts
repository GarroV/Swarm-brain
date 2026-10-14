import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSecondStepRequired, parseSecondStepAudience, secondStepBlocks, secondStepState } from "./second-step.ts";
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
