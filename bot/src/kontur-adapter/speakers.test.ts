import { describe, expect, it } from "vitest";

import { countKonturParticipants, isAloneKonturSnapshot, pickKonturSpeaker } from "./speakers.ts";
import type { KonturSnapshot, KonturTile } from "./types.ts";

function inCall(tiles: KonturTile[], participantCount: number | null = null): KonturSnapshot {
  return {
    title: "Встреча — Толк",
    text: "",
    hasNameInput: false,
    hasContinueButton: false,
    hasJoinButton: false,
    hasMicOnControl: false,
    hasCameraOnControl: false,
    hasParticipantsArea: true,
    tiles,
    participantCount,
  };
}

const BOT = "Scriba Notetaker";

describe("pickKonturSpeaker", () => {
  it("говорящий — плитка с active-speaker", () => {
    const snapshot = inCall([
      { name: "Анна", speaking: false },
      { name: " Борис  Петров ", speaking: true },
    ]);
    expect(pickKonturSpeaker(snapshot, BOT)).toBe("Борис Петров");
  });

  it("никто не подсвечен — null, а не первый попавшийся", () => {
    expect(pickKonturSpeaker(inCall([{ name: "Анна", speaking: false }]), BOT)).toBeNull();
  });

  it("своя плитка не бывает говорящим, даже с пометкой «(Вы)»", () => {
    const snapshot = inCall([
      { name: `${BOT} (Вы)`, speaking: true },
      { name: "Анна", speaking: false },
    ]);
    expect(pickKonturSpeaker(snapshot, BOT)).toBeNull();
  });

  it("подсвеченная плитка без имени — сигнала нет, имя не выдумывается", () => {
    expect(pickKonturSpeaker(inCall([{ name: null, speaking: true }]), BOT)).toBeNull();
    expect(pickKonturSpeaker(inCall([{ name: "  ", speaking: true }]), BOT)).toBeNull();
  });
});

describe("одиночество в Толке", () => {
  it("число на кнопке «Участники» важнее плиток", () => {
    const snapshot = inCall([{ name: BOT, speaking: false }], 3);
    expect(countKonturParticipants(snapshot)).toBe(3);
    expect(isAloneKonturSnapshot(snapshot)).toBe(false);
  });

  it("один бот — один", () => {
    expect(isAloneKonturSnapshot(inCall([{ name: BOT, speaking: false }], 1))).toBe(true);
    expect(isAloneKonturSnapshot(inCall([{ name: BOT, speaking: false }]))).toBe(true);
  });

  it("нет ни числа, ни плиток — сигнала нет, это не «один»", () => {
    expect(isAloneKonturSnapshot(inCall([]))).toBeNull();
  });
});
