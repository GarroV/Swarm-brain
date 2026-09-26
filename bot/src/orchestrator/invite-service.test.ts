/**
 * Провода ручного запуска против строгого двойника сервера по настоящему HTTP: приглашение
 * забирается без подмены личности, бот поднимается от имени позвавшего, а приглашение на
 * площадку без адаптера кончается заявкой по приглашению и нотисой `join_failed` тому же
 * человеку.
 */
import { afterEach, describe, expect, it } from "vitest";

import { type FakeSwarm, startFakeSwarm } from "../swarm-client/testing/fake-swarm.ts";
import type { InviteReference } from "./claim-request.ts";
import { inviteTriggerFor } from "./invite-service.ts";
import type { Notice, NoticeResult } from "./notices.ts";

const TOKEN = "svc-token";
const PERSON = 744_230_399;
const MEET = "https://meet.google.com/abc-defg-hij";

const servers: FakeSwarm[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

interface Wiring {
  readonly server: FakeSwarm;
  readonly starts: [string, string, number, InviteReference][];
  readonly notices: [number, Notice][];
  readonly lines: string[];
  readonly poll: () => Promise<void>;
}

async function wire(): Promise<Wiring> {
  const server = await startFakeSwarm({ token: TOKEN, onBehalfOf: PERSON, requiresInvites: true });
  servers.push(server);
  const starts: Wiring["starts"] = [];
  const notices: Wiring["notices"] = [];
  const lines: string[] = [];
  const trigger = inviteTriggerFor({
    swarmUrl: server.url,
    token: TOKEN,
    version: 3,
    startForMeeting: (joinUrl, platform, onBehalfOf, invite) => {
      starts.push([joinUrl, platform, onBehalfOf, invite]);
      return Promise.resolve("c1");
    },
    notifierFor: (onBehalfOf) => ({
      notify: (notice): Promise<NoticeResult> => {
        notices.push([onBehalfOf, notice]);
        return Promise.resolve({ delivered: true, shouldLeave: false });
      },
    }),
    log: (line) => {
      lines.push(line);
    },
    intervalMs: 50,
  });
  return { server, starts, notices, lines, poll: async () => trigger.pollOnce() };
}

describe("inviteTriggerFor", () => {
  it("приглашение на Meet — бот поднят от имени позвавшего, с приглашением", async () => {
    const w = await wire();
    const invite = w.server.addInvite({ joinUrl: MEET });

    await w.poll();

    expect(w.starts).toEqual([[MEET, "meet", PERSON, { id: invite.id, joinUrl: MEET }]]);
    expect(w.server.requestsTo("/meeting-invite")[0]?.onBehalfOf).toBeNull();
    expect(w.server.inviteState(invite.id)).toEqual({ taken: true, used: false });
  });

  it("приглашение на Контур — заявка по приглашению и join_failed позвавшему", async () => {
    const w = await wire();
    const invite = w.server.addInvite({ joinUrl: "https://ktalk.ru/room/abc", platform: "kontur" });

    await w.poll();

    expect(w.starts).toEqual([]);
    const [claim] = w.server.requestsTo("/meeting-claim");
    expect(claim?.status).toBe(200);
    expect(claim?.onBehalfOf).toBe(String(PERSON));
    expect(claim?.body).toMatchObject({
      identity_kind: "manual",
      invite_id: invite.id,
      join_url: "https://ktalk.ru/room/abc",
      agent_version: "scriba-3",
    });
    expect(w.server.inviteState(invite.id).used).toBe(true);
    const [recipient, notice] = w.notices[0] ?? [];
    expect(recipient).toBe(PERSON);
    expect(notice).toMatchObject({ kind: "join_failed" });
    expect(notice && "meetingId" in notice ? notice.meetingId : "").toMatch(/^m-scriba:/u);
    expect(notice?.detail).toMatch(/Kontur\.Talk/u);
  });

  it("сервер недоступен — опрос сорвался громко в журнал, ничего не запущено и не отказано", async () => {
    const w = await wire();
    w.server.addInvite({ joinUrl: "https://zoom.us/j/123", platform: "zoom" });
    w.server.failNext(10, 500);

    await w.poll();

    expect(w.starts).toEqual([]);
    expect(w.notices).toEqual([]);
    expect(w.lines.join("\n")).toContain("опрос приглашений не удался");
  });

  it("чужой человек в приглашении — отказ сервера на заявке виден в журнале", async () => {
    const w = await wire();
    w.server.addInvite({
      joinUrl: "https://ktalk.ru/room/abc",
      platform: "kontur",
      invitedBy: PERSON + 1,
    });

    await w.poll();

    expect(w.notices).toEqual([]);
    expect(w.lines.some((line) => line.startsWith("ОТКАЗ НЕ ДОСТАВЛЕН"))).toBe(true);
  });
});
