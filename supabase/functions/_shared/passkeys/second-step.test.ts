import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSecondStepRequired,
  parseSecondStepAudience,
  secondStepBlocks,
  secondStepConfigWarnings,
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
    exchanged: false,
    required: false,
    required_from: null,
    session: now,
  });
  assertEquals(secondStepState(login(true), { isDemo: false, required: false, audience: "all" }).done, true);
});

Deno.test("демо и Mini App (нет сессии) — шаг не применим", () => {
  assertEquals(secondStepState(login(false), { isDemo: true, required: true, audience: "all" }).applies, false);
  assertEquals(secondStepState(null, { isDemo: false, required: true, audience: "all" }).applies, false);
});

// Решение 26.10.2026: сессия из обмена личного токена (meeting-webtoken, 12 ч) раньше шла мимо замка
// и получала весь веб без Touch ID. Теперь шаг применим и к ней, а пройти его она не может (Pages
// не ставит метку непродлеваемой сессии) — остаётся только окно заметок рекордера.
Deno.test("короткий токен веб-доступа: шаг применим, помечен как обмен, не пройден", () => {
  const st = secondStepState(shortToken, { isDemo: false, required: true, audience: "all" });
  assertEquals(st.applies, true);
  assertEquals(st.exchanged, true);
  assertEquals(st.done, false);
  assertEquals(secondStepState(login(false), { isDemo: false, required: true, audience: "all" }).exchanged, false);
});

Deno.test("замок включён: сессии из обмена токена открыто только окно заметок рекордера", () => {
  const ex = secondStepState(shortToken, { isDemo: false, required: true, audience: "all" });
  assertEquals(secondStepBlocks(ex, "GET", "/tasks"), true);
  assertEquals(secondStepBlocks(ex, "GET", "/entries"), true);
  assertEquals(secondStepBlocks(ex, "POST", "/mcp/token"), true);
  assertEquals(secondStepBlocks(ex, "GET", "/agent-meetings"), true);
  assertEquals(secondStepBlocks(ex, "PATCH", "/agent-meetings/m1"), true);
  assertEquals(secondStepBlocks(ex, "GET", "/agent-meetings/m1/notes/x"), true);
  assertEquals(secondStepBlocks(ex, "GET", "/agent-meetings/m1"), false);
  assertEquals(secondStepBlocks(ex, "GET", "/agent-meetings/m1/notes"), false);
  assertEquals(secondStepBlocks(ex, "POST", "/agent-meetings/m1/notes"), false);
  assertEquals(secondStepBlocks(ex, "GET", "/me"), false);
  // Обычному входу без Touch ID окно заметок не открыто — у него свой путь: пройти шаг.
  const locked = secondStepState(login(false), { isDemo: false, required: true, audience: "all" });
  assertEquals(secondStepBlocks(locked, "GET", "/agent-meetings/m1/notes"), true);
  // Обычному входу без Touch ID доска шмеля тоже не открыта.
  assertEquals(secondStepBlocks(locked, "GET", "/board/today"), true);
  // Замок выключен — обмен работает как раньше.
  const off = secondStepState(shortToken, { isDemo: false, required: false, audience: "all" });
  assertEquals(secondStepBlocks(off, "GET", "/tasks"), false);
});

// Решение 28.10.2026: доска шмеля (сегодня, экран страны, свои задачи) открыта сессии из обмена токена.
Deno.test("замок включён: сессии из обмена токена открыта доска шмеля, и только её пути и методы", () => {
  const ex = secondStepState(shortToken, { isDemo: false, required: true, audience: "all" });
  for (const [m, p] of [
    ["GET", "/board/today"],
    ["GET", "/board/call"],
    ["PUT", "/board/call"],
    ["POST", "/tasks"],
    ["POST", "/tasks/voice"],
    ["PATCH", "/tasks/t1"],
    ["DELETE", "/tasks/t1"],
    ["GET", "/config"],
  ]) {
    assertEquals(secondStepBlocks(ex, m, p), false, `${m} ${p}`);
  }
  for (const [m, p] of [
    ["GET", "/tasks"],
    ["GET", "/tasks/t1"],
    ["PATCH", "/tasks/t1/comments"],
    ["DELETE", "/board/call"],
    ["PUT", "/config"],
    ["GET", "/board/today/x"],
    ["POST", "/mcp/token"],
    ["GET", "/admin/users"],
  ]) {
    assertEquals(secondStepBlocks(ex, m, p), true, `${m} ${p}`);
  }
});

Deno.test("замок выключен только явным 0/false/off (любой регистр, с пробелами): тогда ничего не блокируется", () => {
  for (const off of ["0", "false", "off", " OFF ", "False", " 0 "]) {
    assertEquals(isSecondStepRequired(off), false, off);
  }
  const st = secondStepState(login(false), {
    isDemo: false,
    required: isSecondStepRequired("0"),
    audience: "all",
  });
  assertEquals(secondStepBlocks(st, "GET", "/tasks"), false);
});

Deno.test("замок включён, когда значение не задано, пусто или не распознано (непонятное значение = замок включён)", () => {
  for (const on of [undefined, "", "  ", "yes", "no", "disabled", "2026-13-01", "26.10.2026", "2026-1-26"]) {
    assertEquals(isSecondStepRequired(on), true, String(on));
  }
  const st = secondStepState(login(false), {
    isDemo: false,
    required: isSecondStepRequired(undefined),
    audience: "all",
  });
  assertEquals(secondStepBlocks(st, "GET", "/tasks"), true);
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

Deno.test("аудитория: явный список — только они; none — никто; не задано, пусто, all и непонятное — все", () => {
  assertEquals(parseSecondStepAudience("5, 744230399 ,7"), new Set([5, 744230399, 7]));
  assertEquals(parseSecondStepAudience("5,"), new Set([5]));
  assertEquals(parseSecondStepAudience("none"), "none");
  assertEquals(parseSecondStepAudience(" NONE "), "none");
  assertEquals(parseSecondStepAudience(undefined), "all");
  assertEquals(parseSecondStepAudience(""), "all");
  assertEquals(parseSecondStepAudience("   "), "all");
  assertEquals(parseSecondStepAudience("all"), "all");
  assertEquals(parseSecondStepAudience(" ALL "), "all");
  assertEquals(parseSecondStepAudience("abc"), "all");
  assertEquals(parseSecondStepAudience("true"), "all");
  assertEquals(parseSecondStepAudience("abc,5"), "all");
  assertEquals(parseSecondStepAudience("5,-3"), "all");
  assertEquals(parseSecondStepAudience("1.5"), "all");
});

Deno.test("предупреждения настроек: только для непустых нераспознанных значений, без самих значений", () => {
  assertEquals(secondStepConfigWarnings(undefined, undefined), []);
  assertEquals(secondStepConfigWarnings("", ""), []);
  assertEquals(secondStepConfigWarnings("1", "all"), []);
  assertEquals(secondStepConfigWarnings("off", "none"), []);
  assertEquals(secondStepConfigWarnings("2026-10-26", "5,7"), []);
  assertEquals(secondStepConfigWarnings("yes", "all"), ["SECOND_STEP_REQUIRED unrecognised, lock on"]);
  assertEquals(secondStepConfigWarnings("1", "abc"), ["SECOND_STEP_AUDIENCE unrecognised, lock on"]);
  assertEquals(secondStepConfigWarnings("2026-13-01", "5,x"), [
    "SECOND_STEP_REQUIRED unrecognised, lock on",
    "SECOND_STEP_AUDIENCE unrecognised, lock on",
  ]);
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

Deno.test("формат замка: 1/true — сразу, дата ISO — по дате, 0/false/off — выключен, пусто, мусор и битая дата — включён", () => {
  const now = new Date(MON_START);
  assertEquals(isSecondStepRequired("1", now), true);
  assertEquals(isSecondStepRequired("true", now), true);
  assertEquals(isSecondStepRequired(" 2026-10-26 ", now), true);
  const later = new Date(MON_START + 400 * 86400_000);
  for (const off of ["0", "false", "off"]) {
    assertEquals(isSecondStepRequired(off, later), false, off);
  }
  for (
    const bad of [
      undefined,
      "",
      "  ",
      "yes",
      "2026-13-01",
      "2026-02-30",
      "26.10.2026",
      "2026-10-26T00:00",
      "2026-1-26",
    ]
  ) {
    assertEquals(isSecondStepRequired(bad, new Date(MON_START - 400 * 86400_000)), true, String(bad));
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
