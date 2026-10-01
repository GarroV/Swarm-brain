import { describe, expect, it } from "vitest";

import { classifyKonturStage, mutedViolation, nextGuestRoomStep } from "./page.ts";
import type { KonturSnapshot } from "./types.ts";

const PAGE_TITLE = "Подключение к встрече — Толк";

function snapshot(overrides: Partial<KonturSnapshot> = {}): KonturSnapshot {
  return {
    title: PAGE_TITLE,
    text: "",
    hasNameInput: false,
    hasContinueButton: false,
    hasJoinButton: false,
    hasMicOnControl: false,
    hasCameraOnControl: false,
    hasParticipantsArea: false,
    tiles: [],
    participantCount: null,
    ...overrides,
  };
}

// Текст закрытой комнаты — слово в слово со страницы (разведка 30.09.2026, боевой образ).
const CLOSED_TEXT =
  "Подключение к встрече Доступ для внешних участников отключен Попросите тех, кто отправил вам " +
  "ссылку, включить доступ для внешних участников Или войдите, если вы являетесь пользователем " +
  "пространства Войти";

describe("classifyKonturStage", () => {
  it("закрытая комната — closed, хотя на странице есть «Войти»", () => {
    expect(classifyKonturStage(snapshot({ text: CLOSED_TEXT })).stage).toBe("closed");
  });

  it("регистр и неразрывные пробелы не мешают узнать закрытую комнату", () => {
    const text = "ДОСТУП ДЛЯ ВНЕШНИХ   участников ОТКЛЮЧЕН";
    expect(classifyKonturStage(snapshot({ text })).stage).toBe("closed");
  });

  it("форма имени — name_form", () => {
    const verdict = classifyKonturStage(
      snapshot({
        text: "Представьтесь, чтобы участники могли вас узнать Запомнить имя Продолжить Авторизация",
        hasNameInput: true,
        hasContinueButton: true,
      }),
    );
    expect(verdict.stage).toBe("name_form");
    expect(verdict.reason).toContain("представьтесь");
  });

  it("экран устройств — devices", () => {
    const verdict = classifyKonturStage(
      snapshot({ text: "Участники встречи: Анна Присоединиться", hasJoinButton: true }),
    );
    expect(verdict.stage).toBe("devices");
  });

  it("звонок узнаётся по структуре, даже если в чате написали фразу закрытой комнаты", () => {
    const verdict = classifyKonturStage(
      snapshot({
        title: "Встреча — Толк",
        text: `чат: ${CLOSED_TEXT}`,
        hasParticipantsArea: true,
        tiles: [{ name: "Анна", speaking: false }],
      }),
    );
    expect(verdict.stage).toBe("in_call");
  });

  it("плитки на экране устройств — ещё не звонок, пока видна «Присоединиться»", () => {
    const verdict = classifyKonturStage(
      snapshot({
        title: "Подключение к встрече — Толк",
        hasParticipantsArea: true,
        tiles: [{ name: "Анна", speaking: false }],
        hasJoinButton: true,
      }),
    );
    expect(verdict.stage).toBe("devices");
  });

  it("заголовок звонка без плиток — ещё не впустили", () => {
    expect(classifyKonturStage(snapshot({ title: "Встреча — Толк" })).stage).toBe("unknown");
  });

  it("пустая или незнакомая страница — unknown, а не звонок", () => {
    expect(classifyKonturStage(snapshot()).stage).toBe("unknown");
    expect(
      classifyKonturStage(snapshot({ text: "Ожидайте, организатор скоро впустит" })).stage,
    ).toBe("unknown");
  });
});

describe("mutedViolation", () => {
  it("нет кнопок «Выключить…» — нарушения нет", () => {
    expect(mutedViolation(snapshot())).toBeNull();
  });

  it("видна «Выключить микрофон» — нарушение с понятной причиной", () => {
    expect(mutedViolation(snapshot({ hasMicOnControl: true }))).toMatch(/включены микрофон/u);
  });

  it("камера тоже нарушение, оба устройства называются", () => {
    expect(mutedViolation(snapshot({ hasCameraOnControl: true }))).toMatch(/включены камера/u);
    expect(mutedViolation(snapshot({ hasMicOnControl: true, hasCameraOnControl: true }))).toMatch(
      /микрофон и камера/u,
    );
  });
});

describe("nextGuestRoomStep", () => {
  const clock = { startedAtMs: 0, lastLoadAtMs: 0, waitMs: 600_000, reloadMs: 25_000 };

  it("не закрытая комната — идём дальше в любой момент", () => {
    for (const stage of ["name_form", "devices", "in_call", "unknown"] as const) {
      expect(nextGuestRoomStep(stage, { ...clock, nowMs: 999_999 })).toBe("proceed");
    }
  });

  it("закрыта и до перезагрузки рано — ждём", () => {
    expect(nextGuestRoomStep("closed", { ...clock, nowMs: 24_999 })).toBe("wait");
  });

  it("закрыта и пора — перезагружаем", () => {
    expect(nextGuestRoomStep("closed", { ...clock, nowMs: 25_000 })).toBe("reload");
    expect(nextGuestRoomStep("closed", { ...clock, lastLoadAtMs: 575_000, nowMs: 590_000 })).toBe(
      "wait",
    );
  });

  it("закрыта десять минут — сдаёмся, даже если пора перезагрузить", () => {
    expect(nextGuestRoomStep("closed", { ...clock, nowMs: 600_000 })).toBe("give_up");
    expect(nextGuestRoomStep("closed", { ...clock, lastLoadAtMs: 575_000, nowMs: 600_001 })).toBe(
      "give_up",
    );
  });
});
