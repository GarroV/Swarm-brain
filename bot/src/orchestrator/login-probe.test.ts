import { describe, expect, it } from "vitest";

import type { MeetSnapshot } from "../meet-adapter/types.ts";
import { probeVerdict } from "./login-probe.ts";

const snapshot = (patch: Partial<MeetSnapshot>): MeetSnapshot => ({
  host: "meet.google.com",
  text: "Video calls and meetings for everyone",
  tiles: [],
  hasSelfTile: false,
  hasPresentControl: false,
  hasNameInput: false,
  hasJoinCta: false,
  hasSignInPrompt: false,
  panelParticipantCount: null,
  captchaChallenge: false,
  ...patch,
});

describe("probeVerdict", () => {
  it("лендинг Meet без просьбы войти — вход жив", () => {
    expect(probeVerdict(snapshot({})).outcome).toBe("probe_ok");
  });

  it("кнопка Sign in — вход слетел", () => {
    expect(probeVerdict(snapshot({ hasSignInPrompt: true })).outcome).toBe(
      "account_signin_required",
    );
  });

  it("увело на accounts.google.com — вход слетел", () => {
    expect(probeVerdict(snapshot({ host: "accounts.google.com" })).outcome).toBe(
      "account_signin_required",
    );
  });

  it("чужая страница (ошибка сети) — вердикта нет", () => {
    expect(probeVerdict(snapshot({ host: "", text: "" })).outcome).toBe("probe_inconclusive");
  });
});
