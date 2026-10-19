import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { classifyMicDenial, detectMicEnv, isRetryableMicError, micSteps } from "./micHelp.ts";

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
};

Deno.test("classifyMicDenial: сайту запретили → site, даже если текст молчит", () => {
  assertEquals(classifyMicDenial("denied", "Permission denied"), "mic-blocked-site");
});

Deno.test("classifyMicDenial: «by system» или granted при отказе → системная стена", () => {
  assertEquals(classifyMicDenial("prompt", "Permission denied by system"), "mic-blocked-os");
  assertEquals(classifyMicDenial("granted", "Permission denied"), "mic-blocked-os");
});

Deno.test("classifyMicDenial: окно закрыли без выбора или API нет → общий отказ", () => {
  assertEquals(classifyMicDenial("prompt", "Permission dismissed"), "permission-denied");
  assertEquals(classifyMicDenial("granted", "Permission dismissed"), "permission-denied");
  assertEquals(classifyMicDenial(undefined, "Permission denied"), "permission-denied");
});

Deno.test("isRetryableMicError: микрофонные ошибки да, демо и неподдерживаемый браузер нет", () => {
  assertEquals(isRetryableMicError("mic-blocked-os"), true);
  assertEquals(isRetryableMicError("no-mic"), true);
  assertEquals(isRetryableMicError("demo"), false);
  assertEquals(isRetryableMicError("unsupported"), false);
});

Deno.test("detectMicEnv: браузер и система по userAgent", () => {
  assertEquals(detectMicEnv({ userAgent: UA.chromeMac }), { browser: "chrome", os: "mac" });
  assertEquals(detectMicEnv({ userAgent: UA.chromeWin }), { browser: "chrome", os: "windows" });
  assertEquals(detectMicEnv({ userAgent: UA.edgeWin }), { browser: "edge", os: "windows" });
  assertEquals(detectMicEnv({ userAgent: UA.safariMac }), { browser: "safari", os: "mac" });
  assertEquals(detectMicEnv({ userAgent: UA.safariIphone }), { browser: "safari", os: "ios" });
  assertEquals(detectMicEnv({ userAgent: UA.chromeIphone }), { browser: "chrome", os: "ios" });
  assertEquals(detectMicEnv({ userAgent: UA.firefoxMac }), { browser: "firefox", os: "mac" });
  assertEquals(detectMicEnv({ userAgent: "curl/8" }), { browser: "other", os: "other" });
});

Deno.test("detectMicEnv: iPad под видом Macintosh — это iOS; userAgentData.brands узнаёт Arc/Chrome", () => {
  assertEquals(detectMicEnv({ userAgent: UA.safariMac, maxTouchPoints: 5 }).os, "ios");
  const arc = detectMicEnv({ userAgent: "Mozilla/5.0 (Macintosh)", userAgentData: { brands: [{ brand: "Chromium" }], platform: "macOS" } });
  assertEquals(arc, { browser: "chrome", os: "mac" });
});

Deno.test("micSteps: сайт — по браузеру", () => {
  const first = (ua: string, os?: number) => micSteps("mic-blocked-site", detectMicEnv({ userAgent: ua, maxTouchPoints: os }))[0].ru;
  assertEquals(first(UA.chromeMac), "Нажмите значок слева от адреса");
  assertEquals(first(UA.safariMac), "Safari → Настройки → Веб-сайты");
  assertEquals(first(UA.safariIphone), "Нажмите «аА» в адресной строке");
  assertEquals(first(UA.firefoxMac), "Нажмите значок разрешений слева от адреса");
  assertNotEquals(first(UA.chromeMac), first(UA.safariMac));
});

Deno.test("micSteps: система — по ОС, и это не шаги про сайт", () => {
  const mac = micSteps("mic-blocked-os", detectMicEnv({ userAgent: UA.chromeMac }));
  const win = micSteps("mic-blocked-os", detectMicEnv({ userAgent: UA.chromeWin }));
  assertEquals(mac[0].ru.startsWith("Системные настройки"), true);
  assertEquals(win[0].ru.startsWith("Параметры"), true);
  assertEquals(mac[2].ru.includes("перезапустите") || mac[2].ru.includes("Перезапустите"), true);
});

Deno.test("micSteps: общий отказ ведёт по шагам сайта; у каждого шага есть EN", () => {
  const env = detectMicEnv({ userAgent: UA.edgeWin });
  assertEquals(micSteps("permission-denied", env), micSteps("mic-blocked-site", env));
  for (const s of micSteps("mic-blocked-os", env)) assertNotEquals(s.en, "");
});
