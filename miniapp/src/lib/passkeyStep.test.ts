import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deadlineLabel, failureNotice, deviceName, shouldAutoStart, stepPending, stepReminder } from "./passkeyStep.ts";
import type { Me } from "@/types";

const me = (over: Partial<Me> = {}, step: Partial<NonNullable<Me["second_step"]>> = {}): Me =>
  ({
    telegram_id: 1,
    name: "A",
    username: null,
    group_id: "g",
    language: null,
    role: null,
    markets: [],
    is_admin: false,
    second_step: { applies: true, done: false, required: false, session: 1_700_000_000, ...step },
    ...over,
  }) as Me;

Deno.test("шаг предлагается только настоящему входу без пройденного шага", () => {
  assertEquals(stepPending(me())?.session, 1_700_000_000);
  assertEquals(stepPending(me({}, { done: true })), null);
  assertEquals(stepPending(me({}, { applies: false })), null);
  assertEquals(stepPending(me({ is_demo: true })), null);
  assertEquals(stepPending(me({ second_step: undefined })), null, "сервер до #955 — поля нет");
  assertEquals(stepPending(null), null);
});

Deno.test("авто-попытка — один раз на вход, новый вход — снова", () => {
  assertEquals(shouldAutoStart(1_700_000_000, null), true);
  assertEquals(shouldAutoStart(1_700_000_000, "1700000000"), false);
  assertEquals(shouldAutoStart(1_700_009_999, "1700000000"), true);
});

Deno.test("имя ключа: браузер · система", () => {
  assertEquals(
    deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Chrome · Mac",
  );
  assertEquals(deviceName("Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605.1.15"), "Safari · Mac");
  assertEquals(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/126 Edg/126"), "Edge · Windows");
  assertEquals(deviceName("curl"), "Browser");
});

Deno.test("осечка подтверждения — та же строка-ссылка, без отсылок к другому устройству", () => {
  assertEquals(failureNotice("get"), "enable_link");
});

Deno.test("осечка первого сохранения — строка-ссылка «Включить вход по Touch ID»", () => {
  assertEquals(failureNotice("create"), "enable_link");
});

Deno.test("стикер-напоминание: нужен применимый непройденный шаг и дата; иначе его нет", () => {
  const from = "2026-10-26";
  assertEquals(stepReminder(me({}, { required_from: from })), { from, required: false });
  assertEquals(stepReminder(me({}, { required_from: from, required: true })), { from, required: true });
  assertEquals(stepReminder(me({}, { required_from: null })), null, "даты нет — не показываем");
  assertEquals(stepReminder(me()), null, "сервер без поля — не показываем");
  assertEquals(stepReminder(me({}, { required_from: "завтра" })), null);
  assertEquals(stepReminder(me({}, { required_from: from, done: true })), null, "палец уже привязан");
  assertEquals(stepReminder(me({}, { required_from: from, applies: false })), null);
  assertEquals(stepReminder(me({ is_demo: true }, { required_from: from })), null);
  assertEquals(stepReminder(null), null);
});

Deno.test("подпись срока: день недели и месяц по языку, пояс браузера сутки не сдвигает", () => {
  assertEquals(deadlineLabel("2026-10-26", "ru"), "С понедельника, 26 октября");
  assertEquals(deadlineLabel("2026-10-26", "en"), "From Monday, October 26");
  assertEquals(deadlineLabel("2026-10-27", "ru"), "Со вторника, 27 октября");
  assertEquals(deadlineLabel("2026-10-28", "ru"), "Со среды, 28 октября");
  assertEquals(deadlineLabel("2026-10-25", "ru"), "С воскресенья, 25 октября");
  assertEquals(deadlineLabel("nope", "ru"), "");
});
