// Заявка записи проверяется по серверному времени встречи: секунды claim на уже существующую
// встречу не больше, чем встреча могла идти. Ядро прав — от этих секунд зависит, чья запись станет
// стенограммой (правило полноты сравнивает их с записью держателя).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  boundClaimSeconds,
  CLAIM_CLOCK_GROWTH_FACTOR,
  CLAIM_EARLY_START_SEC,
  claimSecondsCeiling,
} from "./claim-clock.ts";
import { decideHeld, type HeldRow } from "./arbiter.ts";
import { MAX_RECORDED_SECONDS } from "../_shared/meeting-lease.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const minutesBefore = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString();
const ceilingAfter = (sec: number) => sec * CLAIM_CLOCK_GROWTH_FACTOR + CLAIM_EARLY_START_SEC;

Deno.test("ЯДРО: потолок считается от более раннего из начала встречи и появления строки", () => {
  // Рекордер заявляется на стопе: строка появилась после встречи, начало — из календаря первого заявителя.
  assertEquals(
    claimSecondsCeiling({ started_at: minutesBefore(60), created_at: minutesBefore(5) }, NOW),
    ceilingAfter(3600),
  );
  // Бот заявляется до захода: строка раньше присланного начала.
  assertEquals(
    claimSecondsCeiling({ started_at: minutesBefore(10), created_at: minutesBefore(40) }, NOW),
    ceilingAfter(2400),
  );
  // Начала нет — от появления строки.
  assertEquals(claimSecondsCeiling({ started_at: null, created_at: minutesBefore(30) }, NOW), ceilingAfter(1800));
});

Deno.test("ЯДРО: начало в будущем не даёт отрицательного потолка, остаётся запас на раннее начало записи", () => {
  assertEquals(
    claimSecondsCeiling({ started_at: "2026-09-28T13:00:00.000Z", created_at: NOW }, NOW),
    CLAIM_EARLY_START_SEC,
  );
});

Deno.test("ЯДРО: у строки без читаемого времени потолок — прежний суточный, а не ноль", () => {
  assertEquals(claimSecondsCeiling({ started_at: null, created_at: null }, NOW), MAX_RECORDED_SECONDS);
  assertEquals(claimSecondsCeiling({ started_at: "garbage", created_at: null }, NOW), MAX_RECORDED_SECONDS);
});

Deno.test("ЯДРО: заявка сверх времени встречи урезается до потолка, честная — не трогается", () => {
  const clock = { started_at: minutesBefore(30), created_at: minutesBefore(2) };
  assertEquals(boundClaimSeconds(clock, 86_000, NOW), ceilingAfter(1800));
  assertEquals(boundClaimSeconds(clock, 1700, NOW), 1700);
  assertEquals(boundClaimSeconds(clock, undefined, NOW), undefined, "секунд нет — и не появятся");
});

/** Встреча, которую держит чужая запись; бот не пишет. */
function heldRow(recordedSeconds: number): HeldRow {
  return {
    claim_owner: 111,
    recorded_seconds: recordedSeconds,
    transcript: null,
    notes_edited_at: null,
    status: null,
    lease_expires_at: minutesBefore(1),
    agent_last_recording: false,
  };
}

Deno.test("ЯДРО: заявка сверх времени встречи не перехватывает запись держателя", () => {
  // Встреча шла час и кончилась минуту назад, держатель записал её целиком.
  const clock = { started_at: minutesBefore(61), created_at: minutesBefore(1) };
  const bounded = boundClaimSeconds(clock, 86_000, NOW) ?? 0;
  assertEquals(decideHeld(heldRow(3600), bounded, 222, NOW), "defer");
});

Deno.test("ЯДРО: заметно более полная честная запись по-прежнему перехватывает (issue #23)", () => {
  // Держатель записал 3 минуты и заявился сразу; другой участник писал всю встречу, 2.5 часа.
  const clock = { started_at: minutesBefore(151), created_at: minutesBefore(148) };
  const bounded = boundClaimSeconds(clock, 9000, NOW) ?? 0;
  assertEquals(bounded, 9000);
  assertEquals(decideHeld(heldRow(180), bounded, 222, NOW), "takeover");
});
