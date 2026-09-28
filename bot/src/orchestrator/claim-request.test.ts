/**
 * Заявка бота на ручную встречу. Без приглашения сервер ручную заявку агента отвергает (D017),
 * поэтому приглашение обязано доехать до тела заявки ровно теми полями, что читает сервер.
 *
 * Календарная заявка (T100) — рядом: бот заявляет встречу ключом события, приглашение ей не
 * нужно (D016, сервер сам сверяет календарь человека).
 */
import { describe, expect, it } from "vitest";

import { calendarClaim, claimFor, isCalendarBasis, manualClaim } from "./claim-request.ts";
import type { CalendarReference, InviteReference } from "./claim-request.ts";

const STARTED = "2026-09-26T10:00:00.000Z";

describe("manualClaim", () => {
  it("по приглашению несёт invite_id и ссылку из приглашения", () => {
    const claim = manualClaim({
      runId: "r1",
      version: 7,
      startedAt: STARTED,
      invite: { id: "inv-1", joinUrl: "https://ktalk.ru/room/abc" },
    });

    expect(claim).toEqual({
      identity_kind: "manual",
      identity_key: "scriba:r1",
      started_at: STARTED,
      agent_version: "scriba-7",
      recorded_seconds: 0,
      invite_id: "inv-1",
      join_url: "https://ktalk.ru/room/abc",
    });
  });

  it("без приглашения полей приглашения нет вовсе", () => {
    const claim = manualClaim({ runId: "r2", version: 1, startedAt: STARTED, invite: null });

    expect(claim).not.toHaveProperty("invite_id");
    expect(claim).not.toHaveProperty("join_url");
    expect(claim.identity_key).toBe("scriba:r2");
  });
});

const CALENDAR: CalendarReference = {
  calendarKey: "evt-1:2026-09-28",
  startsAt: "2026-09-28T10:00:00.000Z",
};

const INVITE: InviteReference = { id: "inv-1", joinUrl: "https://meet.google.com/abc-defg-hij" };

describe("calendarClaim", () => {
  it("заявляет календарную встречу ключом события, без приглашения", () => {
    const claim = calendarClaim({ version: 3, calendar: CALENDAR });

    expect(claim).toEqual({
      identity_kind: "calendar",
      identity_key: "evt-1:2026-09-28",
      started_at: "2026-09-28T10:00:00.000Z",
      agent_version: "scriba-3",
      recorded_seconds: 0,
    });
    expect(claim).not.toHaveProperty("invite_id");
    expect(claim).not.toHaveProperty("join_url");
  });
});

describe("isCalendarBasis", () => {
  it("календарное основание опознано", () => {
    expect(isCalendarBasis(CALENDAR)).toBe(true);
  });

  it("приглашение — не календарное основание", () => {
    expect(isCalendarBasis(INVITE)).toBe(false);
  });
});

describe("claimFor", () => {
  it("календарное основание — calendarClaim, приглашение не участвует", () => {
    const claim = claimFor({
      runId: "r3",
      version: 5,
      startedAt: "2026-09-28T09:00:00.000Z",
      basis: CALENDAR,
    });

    expect(claim).toEqual({
      identity_kind: "calendar",
      identity_key: "evt-1:2026-09-28",
      started_at: "2026-09-28T10:00:00.000Z",
      agent_version: "scriba-5",
      recorded_seconds: 0,
    });
  });

  it("основание — приглашение: manualClaim с этим приглашением", () => {
    const claim = claimFor({
      runId: "r4",
      version: 5,
      startedAt: STARTED,
      basis: INVITE,
    });

    expect(claim).toEqual({
      identity_kind: "manual",
      identity_key: "scriba:r4",
      started_at: STARTED,
      agent_version: "scriba-5",
      recorded_seconds: 0,
      invite_id: "inv-1",
      join_url: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("основания нет — manualClaim без приглашения", () => {
    const claim = claimFor({ runId: "r5", version: 0, startedAt: STARTED, basis: null });

    expect(claim).not.toHaveProperty("invite_id");
    expect(claim.identity_kind).toBe("manual");
    expect(claim.identity_key).toBe("scriba:r5");
  });
});
