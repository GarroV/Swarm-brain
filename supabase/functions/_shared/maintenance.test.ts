import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isActive,
  maintenancePayload,
  type MaintenanceState,
  maintenanceVerdict,
  parseMaintenance,
} from "./maintenance.ts";

const NOW = new Date("2026-09-25T23:10:00Z");
const state = (over: Partial<MaintenanceState> = {}): MaintenanceState => ({
  until: "2026-09-25T23:40:00Z",
  messageEn: "Swarm is being updated.",
  messageRu: "Идёт обновление Swarm.",
  startedAt: "2026-09-25T23:05:00Z",
  ...over,
});

Deno.test("правка во время заморозки не проходит — 503 с Retry-After до конца окна", () => {
  const v = maintenanceVerdict({
    state: state(),
    now: NOW,
    method: "POST",
    isOwner: false,
  });
  assertEquals(v.frozen, true);
  if (!v.frozen) return;
  assertEquals(v.retryAfterSec, 1800); // ровно то, что осталось до until
});

Deno.test("чтение во время заморозки проходит — пустой экран пугает сильнее честной плашки", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
    assertEquals(
      maintenanceVerdict({ state: state(), now: NOW, method, isOwner: false })
        .frozen,
      false,
      method,
    );
  }
});

Deno.test("владелец проходит и на запись — иначе он не проверит раскатку и не снимет режим", () => {
  assertEquals(
    maintenanceVerdict({
      state: state(),
      now: NOW,
      method: "POST",
      isOwner: true,
    }).frozen,
    false,
  );
});

Deno.test("истёкший срок гасит режим сам — забытая заморозка не держит продукт", () => {
  const past = new Date("2026-09-26T05:00:00Z");
  assertEquals(isActive(state(), past), false);
  assertEquals(
    maintenanceVerdict({
      state: state(),
      now: past,
      method: "DELETE",
      isOwner: false,
    }).frozen,
    false,
  );
});

Deno.test("Retry-After не уходит за границы: минимум 30 с, максимум час", () => {
  const almostOver = maintenanceVerdict({
    state: state({ until: "2026-09-25T23:10:05Z" }),
    now: NOW,
    method: "POST",
    isOwner: false,
  });
  assertEquals(almostOver.frozen && almostOver.retryAfterSec, 30);

  const long = maintenanceVerdict({
    state: state({ until: "2026-09-26T09:00:00Z" }),
    now: NOW,
    method: "POST",
    isOwner: false,
  });
  assertEquals(long.frozen && long.retryAfterSec, 3600);
});

Deno.test("мусор в настройке читается как «заморозки нет» — продукт не запирается молча", () => {
  for (const bad of [null, undefined, {}, { until: "не дата" }, "строка", 42]) {
    assertEquals(parseMaintenance(bad), null, JSON.stringify(bad ?? null));
  }
});

Deno.test("тексты по умолчанию есть на обоих языках, если их не задали", () => {
  const parsed = parseMaintenance({ until: "2026-09-25T23:40:00Z" });
  assertEquals(typeof parsed?.messageEn, "string");
  assertEquals(typeof parsed?.messageRu, "string");
  assertEquals(parsed!.messageEn.length > 0, true);
  assertEquals(parsed!.messageRu.length > 0, true);
});

Deno.test("пустая строка в тексте не выдаётся за сообщение — падаем на умолчание", () => {
  const parsed = parseMaintenance({
    until: "2026-09-25T23:40:00Z",
    message_en: "   ",
    message_ru: "",
  });
  assertEquals(parsed!.messageEn.trim().length > 0, true);
  assertEquals(parsed!.messageRu.trim().length > 0, true);
});

Deno.test("тело ответа несёт срок и оба языка — веб рисует заглушку по нему же", () => {
  const p = maintenancePayload(state());
  assertEquals(p.maintenance, true);
  assertEquals(p.until, "2026-09-25T23:40:00Z");
  assertEquals(p.message_en, "Swarm is being updated.");
  assertEquals(p.message_ru, "Идёт обновление Swarm.");
});
