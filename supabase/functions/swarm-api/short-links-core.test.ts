// Проверка адреса для сокращателя. Ошибка здесь молчаливая и дорогая: пропущенная схема
// `javascript:` или петля через наш же домен не падает, а переадресует людей не туда.
import { assert, assertEquals } from "@std/assert";
import { generateShortCode, normalizeTargetUrl, SHORT_CODE_LENGTH, SHORT_CODE_RE } from "./short-links-core.ts";

const HOSTS = ["swarm-brain.pages.dev"];

Deno.test("обычная ссылка на PDF проходит как есть", () => {
  assertEquals(
    normalizeTargetUrl("  https://example.com/files/report.pdf?x=1  ", HOSTS),
    { ok: true, url: "https://example.com/files/report.pdf?x=1" },
  );
});

Deno.test("без схемы дописывается https://", () => {
  assertEquals(normalizeTargetUrl("example.com/a.pdf", HOSTS), { ok: true, url: "https://example.com/a.pdf" });
});

Deno.test("не http(s) отбивается: javascript:, data:, ftp:", () => {
  assertEquals(normalizeTargetUrl("javascript:alert(1)", HOSTS), { ok: false, error: "scheme" });
  assertEquals(normalizeTargetUrl("data:text/html,<b>x</b>", HOSTS), { ok: false, error: "scheme" });
  assertEquals(normalizeTargetUrl("ftp://example.com/a", HOSTS), { ok: false, error: "scheme" });
});

Deno.test("логин-пароль в адресе отбивается (маскировка хоста)", () => {
  assertEquals(normalizeTargetUrl("https://bank.com@evil.example/", HOSTS), { ok: false, error: "credentials" });
});

Deno.test("пусто, мусор и хост без точки — отказ", () => {
  assertEquals(normalizeTargetUrl("   ", HOSTS), { ok: false, error: "empty" });
  assertEquals(normalizeTargetUrl("http://", HOSTS), { ok: false, error: "invalid" });
  assertEquals(normalizeTargetUrl("http://localhost:3000/x", HOSTS), { ok: false, error: "invalid" });
});

Deno.test("короткая ссылка на саму себя — петля, остальной наш сайт можно", () => {
  assertEquals(normalizeTargetUrl("https://swarm-brain.pages.dev/s/abc123", HOSTS), { ok: false, error: "loop" });
  assertEquals(normalizeTargetUrl("https://SWARM-BRAIN.pages.dev/s", HOSTS), { ok: false, error: "loop" });
  assertEquals(
    normalizeTargetUrl("https://swarm-brain.pages.dev/settings", HOSTS),
    { ok: true, url: "https://swarm-brain.pages.dev/settings" },
  );
});

Deno.test("слишком длинный адрес — отказ", () => {
  assertEquals(normalizeTargetUrl(`https://example.com/${"a".repeat(2100)}`, HOSTS), { ok: false, error: "too_long" });
});

Deno.test("код: нужной длины, только латиница и цифры, проходит проверку маршрута", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateShortCode();
    assertEquals(code.length, SHORT_CODE_LENGTH);
    assert(SHORT_CODE_RE.test(code), code);
  }
});

Deno.test("код: байты сверх кратного 62 отбрасываются, а не сдвигают распределение", () => {
  // 248..255 — перекос; генератор обязан их пропустить и взять следующие.
  const bytes = [255, 250, 248, 0, 1, 61, 62, 63, 124];
  let i = 0;
  const code = generateShortCode(6, (n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]));
  assertEquals(code, "AB9ABA");
});
