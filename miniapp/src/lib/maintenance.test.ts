import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isMaintenanceActive,
  type Maintenance,
  minutesLeft,
  parseMaintenanceResponse,
  publishMaintenance,
  subscribeMaintenance,
} from "./maintenance.ts";

const NOW = new Date("2026-09-25T23:10:00Z");
const m: Maintenance = {
  until: "2026-09-25T23:40:00Z",
  message_en: "Swarm is being updated.",
  message_ru: "Идёт обновление Swarm.",
};

Deno.test("активный режим виден, истёкший — нет: клиент гасит заглушку сам", () => {
  assertEquals(isMaintenanceActive(m, NOW), true);
  assertEquals(isMaintenanceActive(m, new Date("2026-09-26T00:00:00Z")), false);
});

Deno.test("ответ «работаем» не показывает заглушку", () => {
  assertEquals(parseMaintenanceResponse({ maintenance: false }, NOW), null);
  assertEquals(parseMaintenanceResponse(null, NOW), null);
  assertEquals(parseMaintenanceResponse("что-то", NOW), null);
});

Deno.test("протухший ответ из кэша вкладки заглушку не поднимает", () => {
  const stale = { maintenance: true, ...m };
  assertEquals(
    parseMaintenanceResponse(stale, new Date("2026-09-26T02:00:00Z")),
    null,
  );
});

Deno.test("активный ответ разбирается вместе с обоими языками", () => {
  const parsed = parseMaintenanceResponse({ maintenance: true, ...m }, NOW);
  assertEquals(parsed?.message_en, "Swarm is being updated.");
  assertEquals(parsed?.message_ru, "Идёт обновление Swarm.");
});

Deno.test("остаток показывается целыми минутами и не уходит в минус", () => {
  assertEquals(minutesLeft(m, NOW), 30);
  assertEquals(minutesLeft(m, new Date("2026-09-26T05:00:00Z")), 0);
});

Deno.test("подписка получает и заморозку, и её снятие", () => {
  const seen: (Maintenance | null)[] = [];
  const off = subscribeMaintenance((x) => seen.push(x));
  publishMaintenance(m);
  publishMaintenance(null);
  off();
  publishMaintenance(m);
  assertEquals(seen.length, 2);
  assertEquals(seen[0]?.until, m.until);
  assertEquals(seen[1], null);
  publishMaintenance(null);
});
