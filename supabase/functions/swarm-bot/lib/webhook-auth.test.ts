import { assertEquals } from "jsr:@std/assert@1";
import { classifyRequest, isOwnPrivateChat, type WebhookAuthConfig } from "./webhook-auth.ts";

const CFG: WebhookAuthConfig = { cronSecret: "cron-s3cret", webhookSecret: "tg-s3cret" };

function h(pairs: Record<string, string>): Headers {
  return new Headers(pairs);
}

Deno.test("cron: верное значение X-Cron-Secret → cron", () => {
  assertEquals(classifyRequest(h({ "X-Cron-Secret": "cron-s3cret" }), CFG), "cron");
});

Deno.test("cron: неверное значение X-Cron-Secret → отказ, даже с верным секретом Telegram", () => {
  const headers = h({ "X-Cron-Secret": "whatever", "X-Telegram-Bot-Api-Secret-Token": "tg-s3cret" });
  assertEquals(classifyRequest(headers, CFG), "deny");
});

Deno.test("cron: пустой X-Cron-Secret → отказ", () => {
  assertEquals(classifyRequest(h({ "X-Cron-Secret": "" }), CFG), "deny");
});

Deno.test("cron: CRON_SECRET не задан → любой X-Cron-Secret отказ", () => {
  const cfg = { ...CFG, cronSecret: "" };
  assertEquals(classifyRequest(h({ "X-Cron-Secret": "" }), cfg), "deny");
  assertEquals(classifyRequest(h({ "X-Cron-Secret": "x" }), cfg), "deny");
});

Deno.test("telegram: верный секрет → telegram", () => {
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "tg-s3cret" }), CFG), "telegram");
});

Deno.test("telegram: секрета нет или он неверный → отказ", () => {
  assertEquals(classifyRequest(h({}), CFG), "deny");
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "nope" }), CFG), "deny");
});

Deno.test("telegram: секрет бота не задан → отказ (fail-closed)", () => {
  const cfg = { ...CFG, webhookSecret: "" };
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "" }), cfg), "deny");
});

Deno.test("telegram: проверка безусловная — старый флаг в настройках ничего не отключает", () => {
  const legacy = { ...CFG, enforce: false } as WebhookAuthConfig;
  assertEquals(classifyRequest(h({}), legacy), "deny");
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "nope" }), legacy), "deny");
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "tg-s3cret" }), legacy), "telegram");
});

Deno.test("telegram: секрет бота не задан → отказ любому апдейту, а cron с верным секретом проходит", () => {
  const cfg = { ...CFG, webhookSecret: "" };
  assertEquals(classifyRequest(h({}), cfg), "deny");
  assertEquals(classifyRequest(h({ "X-Telegram-Bot-Api-Secret-Token": "anything" }), cfg), "deny");
  assertEquals(classifyRequest(h({ "X-Cron-Secret": "cron-s3cret" }), cfg), "cron");
});

Deno.test("личный чат: chat.id совпадает с from.id → да", () => {
  assertEquals(isOwnPrivateChat(744230399, 744230399), true);
});

Deno.test("личный чат: другой чат или группа → нет", () => {
  assertEquals(isOwnPrivateChat(-1001234567890, 744230399), false);
  assertEquals(isOwnPrivateChat(111, 744230399), false);
});

Deno.test("личный чат: пустой отправитель → нет", () => {
  assertEquals(isOwnPrivateChat(0, 0), false);
});
