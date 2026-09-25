import { describe, expect, it } from "vitest";

import { MEET_LOCALE, pinMeetLocale } from "./url.ts";

describe("pinMeetLocale", () => {
  it("добавляет hl=en к обычной ссылке на встречу", () => {
    expect(pinMeetLocale("https://meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij?hl=en",
    );
  });

  it("перебивает чужой язык: hl=ru уезжает, остаётся en", () => {
    expect(pinMeetLocale("https://meet.google.com/abc-defg-hij?hl=ru")).toBe(
      "https://meet.google.com/abc-defg-hij?hl=en",
    );
  });

  it("сохраняет остальные параметры ссылки", () => {
    expect(pinMeetLocale("https://meet.google.com/abc-defg-hij?authuser=0&pli=1")).toBe(
      "https://meet.google.com/abc-defg-hij?authuser=0&pli=1&hl=en",
    );
  });

  it("не трогает ссылку, где локаль уже запиннена", () => {
    const pinned = `https://meet.google.com/abc-defg-hij?hl=${MEET_LOCALE}`;
    expect(pinMeetLocale(pinned)).toBe(pinned);
  });

  it("отказывается от чужой площадки громко, а не молча ведёт бота не туда", () => {
    expect(() => pinMeetLocale("https://zoom.us/j/123")).toThrow(/meet\.google\.com/);
  });

  it("отказывается от мусора вместо ссылки", () => {
    expect(() => pinMeetLocale("не ссылка")).toThrow(/не разобрана/);
  });

  it("отказывается от не-https: бот ходит в интернет, подмена схемы — не мелочь", () => {
    // Схема собирается из кусков намеренно: `eslint --fix` переписывает литерал
    // «http://…» в «https://…» (unicorn/prefer-https) и молча превращает эту проверку
    // в тавтологию — поймано на живом прогоне 2026-09-23.
    const scheme = ["ht", "tp:"].join("");
    const insecure = `${scheme}//meet.google.com/abc-defg-hij`;
    expect(() => pinMeetLocale(insecure)).toThrow(/https/);
  });
});
