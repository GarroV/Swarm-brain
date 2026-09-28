import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  freezeWindow,
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

Deno.test("окно работ: время начала/конца, длительность и фаза по часам смотрящего (#609)", () => {
  const n = { starts_at: "2026-09-28T21:30:00Z", until: "2026-09-28T22:00:00Z" };
  const before = freezeWindow(n, "en-GB", new Date("2026-09-28T21:00:00Z"));
  assertEquals(before?.minutes, 30);
  assertEquals(before?.phase, "planned");
  assertEquals(freezeWindow(n, "en-GB", new Date("2026-09-28T21:40:00Z"))?.phase, "running");
  assertEquals(freezeWindow(n, "en-GB", new Date("2026-09-28T22:01:00Z"))?.phase, "over");
  assertEquals(
    freezeWindow({ ...n, cancelled_at: "2026-09-28T21:10:00Z" }, "en-GB", new Date("2026-09-28T21:40:00Z"))?.phase,
    "cancelled",
  );
});

Deno.test("окно работ: битые или перевёрнутые времена не рисуются вовсе", () => {
  assertEquals(freezeWindow(null, "en-GB"), null);
  assertEquals(freezeWindow({ starts_at: "завтра", until: "2026-09-28T22:00:00Z" }, "en-GB"), null);
  assertEquals(
    freezeWindow({ starts_at: "2026-09-28T22:00:00Z", until: "2026-09-28T21:00:00Z" }, "en-GB"),
    null,
  );
});
