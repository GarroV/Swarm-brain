// Запуск: deno test supabase/functions/swarm-bot/lib/integration-health.test.ts
//
// Состояние Granola (#175): сбой отличим от пустоты, человеку — одно сообщение на смене
// состояния, а не каждый час.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { brokeMessage, decideNotice, describeGranolaFailure } from "./integration-health.ts";

Deno.test("причина сбоя: статус и код Granola из тела", () => {
  assertEquals(
    describeGranolaFailure(403, JSON.stringify({ code: "SUBSCRIPTION_INACTIVE", message: "…" })),
    "HTTP 403 SUBSCRIPTION_INACTIVE",
  );
  assertEquals(describeGranolaFailure(502, "<html>bad gateway</html>"), "HTTP 502");
});

const DAY = new Date("2026-10-02T10:00:00Z"); // 12:00 по Белграду
const NIGHT = new Date("2026-10-02T02:00:00Z"); // 04:00 по Белграду

Deno.test("о сбое — один раз и днём", () => {
  const first = decideNotice(null, "HTTP 403", DAY);
  assertEquals(first.send, "broke");
  assertEquals(decideNotice(first.notifiedAt, "HTTP 403", DAY), { send: null, notifiedAt: first.notifiedAt });
});

Deno.test("ночной сбой не будит — сообщит первый дневной опрос", () => {
  assertEquals(decideNotice(null, "HTTP 403", NIGHT), { send: null, notifiedAt: null });
  assertEquals(decideNotice(null, "HTTP 403", DAY).send, "broke");
});

Deno.test("восстановление — только если о сбое сообщали", () => {
  assertEquals(decideNotice("2026-10-01T10:00:00Z", null, DAY), { send: "recovered", notifiedAt: null });
  assertEquals(decideNotice(null, null, DAY), { send: null, notifiedAt: null });
});

Deno.test("неактивная подписка названа прямо, на двух языках", () => {
  const text = brokeMessage("HTTP 403 SUBSCRIPTION_INACTIVE");
  assertStringIncludes(text, "subscription is inactive");
  assertStringIncludes(text, "подписка рабочего пространства неактивна");
});
