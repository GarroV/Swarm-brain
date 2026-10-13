// Запуск: npm test (deno test -A --no-check --config ../deno.json src/lib/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { integrationHealth, integrationStatusText, STALE_DAYS } from "./integrationStatus.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const health = (active: boolean, lastSeenAt: string | null | undefined, staleDays: number) =>
  integrationHealth({ active, lastSeenAt, staleDays, now: NOW });

Deno.test("токена нет → off, даже если отметка осталась", () => {
  assertEquals(health(false, daysAgo(1), 3), "off");
});

Deno.test("токен есть, клиент ни разу не обращался → never", () => {
  assertEquals(health(true, null, 3), "never");
});

Deno.test("сервер не отдаёт lastSeenAt (старый API) → unknown, а не «не отвечает»", () => {
  assertEquals(health(true, undefined, 3), "unknown");
});

Deno.test("рекордер: порог 3 дня", () => {
  assertEquals(health(true, daysAgo(2), STALE_DAYS.recorder), "alive");
  assertEquals(health(true, daysAgo(4), STALE_DAYS.recorder), "stale");
});

Deno.test("Claude Desktop: порог 14 дней", () => {
  assertEquals(health(true, daysAgo(10), STALE_DAYS.claude), "alive");
  assertEquals(health(true, daysAgo(15), STALE_DAYS.claude), "stale");
});

Deno.test("нечитаемая дата → unknown", () => {
  assertEquals(health(true, "не дата", 3), "unknown");
});

const dt = (ru: string, _en: string) => ru;
const fmt = (iso: string) => `<${iso.slice(0, 10)}>`;

Deno.test("тексты: подключён с датой, молчит с датой, ни разу — с подсказкой", () => {
  const seen = daysAgo(1);
  assertEquals(integrationStatusText("alive", seen, dt, fmt).label, "Подключён · <2026-10-12>");
  assertEquals(integrationStatusText("stale", seen, dt, fmt).label, "Не отвечает · последнее обращение <2026-10-12>");
  const never = integrationStatusText("never", null, dt, fmt);
  assertEquals(never.label, "Не отвечает");
  assertEquals(never.hint?.startsWith("Клиент ещё не обращался к серверу"), true);
  assertEquals(integrationStatusText("off", null, dt, fmt), { label: "Не подключён", hint: null });
});
