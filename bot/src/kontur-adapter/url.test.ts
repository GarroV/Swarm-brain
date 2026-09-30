import { describe, expect, it } from "vitest";

import { checkKonturUrl } from "./url.ts";

describe("checkKonturUrl", () => {
  it("пропускает комнату пространства ktalk.ru как есть, без фрагмента", () => {
    expect(checkKonturUrl("https://dodobrands.ktalk.ru/abc123#x")).toBe(
      "https://dodobrands.ktalk.ru/abc123",
    );
  });

  it("пропускает talk.kontur.<зона>", () => {
    expect(checkKonturUrl("https://talk.kontur.ru/room/abc")).toBe(
      "https://talk.kontur.ru/room/abc",
    );
  });

  it("отвергает похожие на Толк чужие хосты", () => {
    expect(() => checkKonturUrl("https://evilktalk.ru/abc")).toThrow(/только Контур.Толк/u);
    expect(() => checkKonturUrl("https://ktalk.ru.evil.com/abc")).toThrow(/только Контур.Толк/u);
    expect(() => checkKonturUrl("https://talk.kontur.ru.evil.com/abc")).toThrow(
      /только Контур.Толк/u,
    );
    expect(() => checkKonturUrl("https://meet.google.com/abc-defg-hij")).toThrow(
      /только Контур.Толк/u,
    );
  });

  it("отвергает не-https, учётные данные, пространство без комнаты и мусор", () => {
    const insecure = ["ht", "tp://dodobrands.ktalk.ru/abc"].join("");
    expect(() => checkKonturUrl(insecure)).toThrow(/https/u);
    expect(() => checkKonturUrl("https://u:p@dodobrands.ktalk.ru/abc")).toThrow(/учётные/u);
    expect(() => checkKonturUrl("https://dodobrands.ktalk.ru/")).toThrow(/нет комнаты/u);
    expect(() => checkKonturUrl("не ссылка")).toThrow(/не разобрана/u);
  });
});
