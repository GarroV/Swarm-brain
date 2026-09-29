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
  host: "meet.google.com",
  hasSignInPrompt: false,
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

  it("страница ошибки («check your meeting code») — встречи нет, а не отказ хоста", () => {
    expect(classifyAdmission(snapshot({ text: "Check your meeting code" })).state).toBe(
      "unavailable",
    );
  });

  it("встреча закончилась — встречи нет, а не отказ хоста", () => {
    expect(classifyAdmission(snapshot({ text: "This meeting has ended" })).state).toBe(
      "unavailable",
    );
  });

  it("живая страница «You can’t join this video call» (снята 28.09 с meet.google.com) — не пустили гостя, а не отказ хоста", () => {
    const livePage =
      "You can’t join this video call\nReturn to home screen\nSubmit feedback\nYour meeting is safe\n" +
      "No one can join a meeting unless invited or admitted by the host\nLearn more";
    const verdict = classifyAdmission(snapshot({ text: livePage }));
    expect(verdict.state).toBe("blocked");
    expect(verdict.reason).toMatch(/can't join this video call/);
  });

  it("прямой отказ хоста остаётся отказом, даже рядом с текстом страницы ошибки", () => {
    const verdict = classifyAdmission(
      snapshot({
        text: "Someone in the call denied your request to join. You can't join this video call",
      }),
    );
    expect(verdict.state).toBe("denied");
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

describe("classifyAdmission: вход бота под своим аккаунтом (T175)", () => {
  const signedIn = { isSignedIn: true } as const;
  const guestLobby = snapshot({ hasNameInput: true, hasJoinCta: true, hasSignInPrompt: true });

  it("страница входа Google при сохранённом входе — вход слетел, а не «ждём у двери»", () => {
    const verdict = classifyAdmission(
      snapshot({ host: "accounts.google.com", text: "sign in to continue to google meet" }),
      signedIn,
    );
    expect(verdict.state).toBe("signin_required");
    expect(verdict.reason).toContain("accounts.google.com");
  });

  it("Google просит подтвердить, что это ты, — вход требует человека", () => {
    const verdict = classifyAdmission(
      snapshot({ host: "accounts.google.com", text: "Verify it’s you" }),
      signedIn,
    );
    expect(verdict.state).toBe("signin_required");
  });

  it("лобби гостя при сохранённом входе — сессия умерла молча, бот не стучится гостем", () => {
    expect(classifyAdmission(guestLobby, signedIn).state).toBe("signin_required");
  });

  it("поле имени гостя при сохранённом входе, даже без кнопки «Sign in», — вход не действует", () => {
    const bareLobby = snapshot({ hasNameInput: true, hasJoinCta: true });
    expect(classifyAdmission(bareLobby, signedIn).state).toBe("signin_required");
  });

  it("кнопка «Sign in» на странице ошибки при сохранённом входе — вход слетел, а не «не пустили гостя»", () => {
    const verdict = classifyAdmission(
      snapshot({ text: "You can’t join this video call", hasSignInPrompt: true }),
      signedIn,
    );
    expect(verdict.state).toBe("signin_required");
  });

  it("просьба подтвердить вход прямо на странице Meet — тоже вход, с фразой в причине", () => {
    const verdict = classifyAdmission(snapshot({ text: "Confirm it’s you to continue" }), signedIn);
    expect(verdict.state).toBe("signin_required");
    expect(verdict.reason).toContain("confirm it's you");
  });

  it("без сохранённого входа лобби гостя — по-прежнему ожидание", () => {
    expect(classifyAdmission(guestLobby).state).toBe("waiting");
  });

  it("без сохранённого входа страница входа Google — встреча не пускает гостя (blocked), а не про аккаунт бота", () => {
    const verdict = classifyAdmission(
      snapshot({ host: "accounts.google.com", text: "sign in to continue to google meet" }),
    );
    expect(verdict.state).toBe("blocked");
  });

  it("под своим аккаунтом «Ask to join» без поля имени — лобби, стоим дальше", () => {
    const verdict = classifyAdmission(
      snapshot({ hasJoinCta: true, text: "ask to join" }),
      signedIn,
    );
    expect(verdict.state).toBe("waiting");
  });

  it("под своим аккаунтом впустили — впустили", () => {
    expect(classifyAdmission(inCall, signedIn).state).toBe("admitted");
  });

  it("прямой отказ хоста сильнее всего, и под аккаунтом тоже", () => {
    const verdict = classifyAdmission(
      snapshot({ text: "denied your request to join", hasSignInPrompt: true }),
      signedIn,
    );
    expect(verdict.state).toBe("denied");
  });
});
