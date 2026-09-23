import { describe, expect, it } from "vitest";

import { classifyAdmission, normalizeMeetText } from "./admission.ts";
import type { MeetSnapshot } from "./types.ts";

const blank: MeetSnapshot = {
  text: "",
  hasNameInput: false,
  hasJoinCta: false,
  hasSelfTile: false,
  hasPresentControl: false,
  captchaChallenge: false,
  tiles: [],
  panelParticipantCount: null,
};

const snapshot = (patch: Partial<MeetSnapshot>): MeetSnapshot => ({ ...blank, ...patch });

const inCall = snapshot({
  hasSelfTile: true,
  hasPresentControl: true,
  tiles: [{ id: "t1", name: "scriba", self: true, audioLevel: 0 }],
});

describe("normalizeMeetText", () => {
  it("сводит типографский апостроф к прямому — живой Meet пишет именно им", () => {
    expect(normalizeMeetText("You weren’t allowed to join")).toContain("weren't allowed to join");
  });

  it("схлопывает переносы и регистр", () => {
    expect(normalizeMeetText("Asking\n  to   be\tLET IN")).toBe("asking to be let in");
  });
});

describe("classifyAdmission", () => {
  it("плитки участников и своя плитка — впустили", () => {
    expect(classifyAdmission(inCall).state).toBe("admitted");
  });

  it("лобби гостя (поле имени и кнопка входа) — ещё не впустили", () => {
    const verdict = classifyAdmission(snapshot({ hasNameInput: true, hasJoinCta: true }));
    expect(verdict.state).toBe("waiting");
  });

  it("«asking to be let in» — стоим у двери", () => {
    expect(classifyAdmission(snapshot({ text: "asking to be let in" })).state).toBe("waiting");
  });

  it("«return to home screen» сам по себе отказом не считается (регресс Vexa #471)", () => {
    const verdict = classifyAdmission(
      snapshot({ text: "asking to be let in return to home screen" }),
    );
    expect(verdict.state).toBe("waiting");
  });

  it("хост отказал — отказ, даже если текст лобби ещё висит в DOM", () => {
    const verdict = classifyAdmission(
      snapshot({
        text: "asking to be let in someone in the call denied your request to join",
        hasJoinCta: true,
      }),
    );
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toMatch(/denied your request/);
  });

  it("отказ с типографским апострофом узнаётся так же", () => {
    expect(classifyAdmission(snapshot({ text: "You weren’t allowed to join" })).state).toBe(
      "denied",
    );
  });

  it("страница ошибки («check your meeting code») — отказ, а не ожидание", () => {
    expect(classifyAdmission(snapshot({ text: "Check your meeting code" })).state).toBe("denied");
  });

  it("встреча закончилась — отказ", () => {
    expect(classifyAdmission(snapshot({ text: "This meeting has ended" })).state).toBe("denied");
  });

  it("живая капча поверх ожидания — капча", () => {
    const verdict = classifyAdmission(
      snapshot({ text: "asking to be let in", captchaChallenge: true }),
    );
    expect(verdict.state).toBe("captcha");
  });

  it("прямой отказ хоста сильнее капчи: капча не отменяет «нет» от человека", () => {
    const verdict = classifyAdmission(
      snapshot({ text: "denied your request to join", captchaChallenge: true }),
    );
    expect(verdict.state).toBe("denied");
  });

  it("текст ожидания перебивает признаки звонка: тулбар виден и в лобби", () => {
    const verdict = classifyAdmission({ ...inCall, text: "asking to be let in" });
    expect(verdict.state).toBe("waiting");
  });

  it("пустая страница — ждём дальше, но причина названа", () => {
    const verdict = classifyAdmission(blank);
    expect(verdict.state).toBe("waiting");
    expect(verdict.reason).not.toBe("");
  });
});
