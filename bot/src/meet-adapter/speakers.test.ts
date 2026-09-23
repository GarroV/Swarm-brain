import { describe, expect, it } from "vitest";

import {
  countParticipants,
  hasSpeakerSignal,
  isAloneSnapshot,
  normalizeParticipantName,
  pickActiveSpeaker,
} from "./speakers.ts";
import type { MeetSnapshot, MeetTile } from "./types.ts";

const tile = (patch: Partial<MeetTile> & { id: string }): MeetTile => ({
  name: null,
  self: false,
  audioLevel: null,
  ...patch,
});

const snapshot = (tiles: readonly MeetTile[], panel: number | null = null): MeetSnapshot => ({
  text: "",
  hasNameInput: false,
  hasJoinCta: false,
  hasSelfTile: tiles.some((t) => t.self),
  hasPresentControl: true,
  captchaChallenge: false,
  tiles,
  panelParticipantCount: panel,
});

describe("normalizeParticipantName", () => {
  it("снимает пометку «(You)» — это не часть имени", () => {
    expect(normalizeParticipantName("Василий Гарро (You)")).toBe("Василий Гарро");
  });

  it("снимает пометку о показе экрана", () => {
    expect(normalizeParticipantName("Василий Гарро (Presenting)")).toBe("Василий Гарро");
  });

  it("пустое имя — это отсутствие имени, а не пустая строка", () => {
    expect(normalizeParticipantName("   ")).toBeNull();
  });
});

describe("pickActiveSpeaker", () => {
  it("возвращает имя говорящего участника", () => {
    const state = snapshot([
      tile({ id: "self", name: "scriba", self: true, audioLevel: 0 }),
      tile({ id: "a", name: "Василий Гарро", audioLevel: 0.7 }),
      tile({ id: "b", name: "Анна", audioLevel: 0 }),
    ]);
    expect(pickActiveSpeaker(state)).toBe("Василий Гарро");
  });

  it("свою плитку не называет никогда — бот не участник разговора", () => {
    const state = snapshot([tile({ id: "self", name: "scriba", self: true, audioLevel: 0.9 })]);
    expect(pickActiveSpeaker(state)).toBeNull();
  });

  it("плитку с именем бота не называет, даже если маркер «своей» не прочитался", () => {
    const state = snapshot([tile({ id: "x", name: "scriba", audioLevel: 0.9 })]);
    expect(pickActiveSpeaker(state, "scriba")).toBeNull();
  });

  it("говорят двое — берём того, у кого звук громче", () => {
    const state = snapshot([
      tile({ id: "a", name: "Анна", audioLevel: 0.3 }),
      tile({ id: "b", name: "Борис", audioLevel: 0.8 }),
    ]);
    expect(pickActiveSpeaker(state)).toBe("Борис");
  });

  it("при равной громкости выбор устойчив — первый по порядку в DOM", () => {
    const state = snapshot([
      tile({ id: "a", name: "Анна", audioLevel: 0.5 }),
      tile({ id: "b", name: "Борис", audioLevel: 0.5 }),
    ]);
    expect(pickActiveSpeaker(state)).toBe("Анна");
  });

  it("молчат все — null, а не последний говоривший", () => {
    const state = snapshot([tile({ id: "a", name: "Анна", audioLevel: 0 })]);
    expect(pickActiveSpeaker(state)).toBeNull();
  });

  it("имени у говорящей плитки нет — имя не выдумывается", () => {
    const state = snapshot([tile({ id: "a", name: null, audioLevel: 0.9 })]);
    expect(pickActiveSpeaker(state)).toBeNull();
  });

  it("атрибута громкости нет ни у кого — это отсутствие сигнала, а не тишина", () => {
    const state = snapshot([
      tile({ id: "a", name: "Анна" }),
      tile({ id: "b", name: "Борис" }),
    ]);
    expect(hasSpeakerSignal(state)).toBe(false);
    expect(pickActiveSpeaker(state)).toBeNull();
  });

  it("атрибут громкости есть — сигнал признаётся живым, даже если сейчас все молчат", () => {
    expect(hasSpeakerSignal(snapshot([tile({ id: "a", name: "Анна", audioLevel: 0 })]))).toBe(true);
  });
});

describe("countParticipants и isAloneSnapshot", () => {
  it("панель участников важнее плиток: в галерее видны не все", () => {
    const state = snapshot([tile({ id: "self", name: "scriba", self: true })], 4);
    expect(countParticipants(state)).toBe(4);
    expect(isAloneSnapshot(state)).toBe(false);
  });

  it("панели нет — считаем по плиткам", () => {
    const state = snapshot([
      tile({ id: "self", name: "scriba", self: true }),
      tile({ id: "a", name: "Анна" }),
    ]);
    expect(countParticipants(state)).toBe(2);
    expect(isAloneSnapshot(state)).toBe(false);
  });

  it("одна своя плитка — бот в звонке один", () => {
    expect(isAloneSnapshot(snapshot([tile({ id: "self", name: "scriba", self: true })]))).toBe(true);
  });

  it("сигнала нет вовсе — «не знаю», а не «один»: уйти по ошибке дороже, чем постоять", () => {
    expect(isAloneSnapshot(snapshot([]))).toBeNull();
    expect(countParticipants(snapshot([]))).toBeNull();
  });
});
