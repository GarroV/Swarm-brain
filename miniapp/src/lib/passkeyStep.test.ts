import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { failureNotice, deviceName, shouldAutoStart, stepPending } from "./passkeyStep.ts";
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
