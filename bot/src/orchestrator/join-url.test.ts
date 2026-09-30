import { describe, expect, it } from "vitest";

import { joinUrlFor } from "./join-url.ts";

describe("joinUrlFor — ссылку проверяет адаптер своей площадки, до подъёма контейнера", () => {
  it("Meet — язык запиннен", () => {
    expect(joinUrlFor("meet", "https://meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij?hl=en",
    );
  });

  it("Толк — ссылка как есть", () => {
    expect(joinUrlFor("kontur", "https://dodobrands.ktalk.ru/abc")).toBe(
      "https://dodobrands.ktalk.ru/abc",
    );
  });

  it("площадка и ссылка не сходятся — отказ, а не контейнер не туда", () => {
    expect(() => joinUrlFor("kontur", "https://meet.google.com/abc-defg-hij")).toThrow(
      /только Контур.Толк/u,
    );
    expect(() => joinUrlFor("meet", "https://dodobrands.ktalk.ru/abc")).toThrow(/meet.google.com/u);
  });
});
