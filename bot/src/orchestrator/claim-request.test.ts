/**
 * Заявка бота на ручную встречу. Без приглашения сервер ручную заявку агента отвергает (D017),
 * поэтому приглашение обязано доехать до тела заявки ровно теми полями, что читает сервер.
 */
import { describe, expect, it } from "vitest";

import { manualClaim } from "./claim-request.ts";

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
