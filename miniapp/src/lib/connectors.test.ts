// Запуск: npm test (deno test -A --no-check --config ../deno.json src/lib/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildConnectors, connectorsSummary, type ConnectorsInput } from "./connectors.ts";

const NOW = new Date("2026-09-04T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

const input = (over: Partial<ConnectorsInput> = {}): ConnectorsInput => ({
  services: [],
  recorder: { active: false, expiresAt: null },
  mcp: { active: false, expiresAt: null },
  telegramLinked: false,
  now: NOW,
  ...over,
});

const stateOf = (i: ConnectorsInput, id: string) =>
  buildConnectors(i).find((c) => c.id === id)?.state;

Deno.test("календарь не подключён → off", () => {
  assertEquals(stateOf(input(), "calendar"), "off");
});

Deno.test("календарь в списке интеграций → connected", () => {
  assertEquals(stateOf(input({ services: ["google_calendar"] }), "calendar"), "connected");
});

Deno.test("рекордер: токен на месяц вперёд → connected", () => {
  assertEquals(stateOf(input({ recorder: { active: true, expiresAt: inDays(30) } }), "recorder"), "connected");
});

Deno.test("рекордер: токен истекает через 5 дней → expiring", () => {
  assertEquals(stateOf(input({ recorder: { active: true, expiresAt: inDays(5) } }), "recorder"), "expiring");
});

// Главное требование владельца и урок #175: протухший токен НЕ равен «не подключён».
// Иначе человек видит «подключи» там, где надо «переподключи», и не понимает, что сломалось.
Deno.test("рекордер: токен истёк → expired, а не off", () => {
  assertEquals(stateOf(input({ recorder: { active: true, expiresAt: inDays(-1) } }), "recorder"), "expired");
});

Deno.test("рекордер: никогда не подключался → off, даже с пустым сроком", () => {
  assertEquals(stateOf(input({ recorder: { active: false, expiresAt: null } }), "recorder"), "off");
});

Deno.test("telegram: привязан → connected", () => {
  assertEquals(stateOf(input({ telegramLinked: true }), "telegram"), "connected");
});

Deno.test("сортировка: требующие внимания идут первыми, подключённые — последними", () => {
  const list = buildConnectors(input({
    services: ["google_calendar", "granola"],
    recorder: { active: true, expiresAt: inDays(-1) },
    mcp: { active: true, expiresAt: null },
    telegramLinked: false,
  }));
  assertEquals(list.map((c) => c.id), ["recorder", "telegram", "calendar", "granola", "claude"]);
});

Deno.test("сводка считает подключённые и требующие внимания", () => {
  const list = buildConnectors(input({
    services: ["google_calendar"],
    recorder: { active: true, expiresAt: inDays(-1) },
    telegramLinked: true,
  }));
  assertEquals(connectorsSummary(list), { connected: 2, total: 5, attention: 1 });
});

Deno.test("expiring тоже требует внимания в сводке", () => {
  const list = buildConnectors(input({ recorder: { active: true, expiresAt: inDays(3) } }));
  assertEquals(connectorsSummary(list).attention, 1);
});
