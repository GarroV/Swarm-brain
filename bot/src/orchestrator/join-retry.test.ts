/**
 * Что считается сбоем загрузки страницы (повторяем заход), а что отказом по существу (нет).
 */
import { describe, expect, it } from "vitest";

import { isTransientLoadError } from "./join-retry.ts";

describe("isTransientLoadError", () => {
  it.each([
    'page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating to "https://meet.google.com/x?hl=en", waiting until "domcontentloaded"',
    "page.goto: net::ERR_INTERNET_DISCONNECTED at https://meet.google.com/x",
    "read ECONNRESET",
    "Target page, context or browser has been closed",
  ])("сбой загрузки: %s", (message) => {
    expect(isTransientLoadError(message)).toBe(true);
  });

  it.each([
    "Комната закрыта для гостей — в звонок не входим",
    "Cannot read properties of undefined",
  ])("не сбой загрузки: %s", (message) => {
    expect(isTransientLoadError(message)).toBe(false);
  });
});
