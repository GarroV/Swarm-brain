import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSecondStepRequired, secondStepBlocks, secondStepState } from "./second-step.ts";
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
  assertEquals(secondStepState(login(false), { isDemo: false, required: false }), {
    applies: true,
    done: false,
    required: false,
    session: now,
  });
  assertEquals(secondStepState(login(true), { isDemo: false, required: false }).done, true);
});

Deno.test("демо, Mini App (нет сессии) и короткий токен веб-доступа — шаг не применим", () => {
  assertEquals(secondStepState(login(false), { isDemo: true, required: true }).applies, false);
  assertEquals(secondStepState(null, { isDemo: false, required: true }).applies, false);
  assertEquals(secondStepState(shortToken, { isDemo: false, required: true }).applies, false);
});

Deno.test("замок выключен по умолчанию: ничего не блокируется", () => {
  assertEquals(isSecondStepRequired(undefined), false);
  assertEquals(isSecondStepRequired("0"), false);
  assertEquals(isSecondStepRequired(""), false);
  const st = secondStepState(login(false), { isDemo: false, required: isSecondStepRequired(undefined) });
  assertEquals(secondStepBlocks(st, "GET", "/tasks"), false);
});

Deno.test("замок включён: сессия без шага закрыта, кроме /me, выхода и заглушки работ; с шагом — открыта", () => {
  assertEquals(isSecondStepRequired("1"), true);
  const locked = secondStepState(login(false), { isDemo: false, required: true });
  assertEquals(secondStepBlocks(locked, "GET", "/tasks"), true);
  assertEquals(secondStepBlocks(locked, "POST", "/tasks"), true);
  assertEquals(secondStepBlocks(locked, "PATCH", "/me"), true);
  assertEquals(secondStepBlocks(locked, "GET", "/me"), false);
  assertEquals(secondStepBlocks(locked, "POST", "/auth/revoke-sessions"), false);
  assertEquals(secondStepBlocks(locked, "GET", "/maintenance"), false);
  const done = secondStepState(login(true), { isDemo: false, required: true });
  assertEquals(secondStepBlocks(done, "GET", "/tasks"), false);
  const demo = secondStepState(login(false), { isDemo: true, required: true });
  assertEquals(secondStepBlocks(demo, "GET", "/tasks"), false);
});
