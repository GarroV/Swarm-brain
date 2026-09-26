import { describe, expect, it } from "vitest";

import { JournaledNotifier, describeNotice } from "./notices.ts";

describe("нотисы в журнале", () => {
  it("строка журнала несёт вид, привязку и причину", () => {
    expect(describeNotice({ kind: "container_died", meetingId: "m-1", detail: "exit 137" })).toBe(
      'NOTICE container_died meeting_id=m-1 detail="exit 137"',
    );
    expect(describeNotice({ kind: "no_owner", meetingKey: "evt:2026-09-26" })).toBe(
      "NOTICE no_owner meeting_key=evt:2026-09-26",
    );
  });

  it("доставленная нотиса пишется вместе с решением сервера", async () => {
    const lines: string[] = [];
    const notifier = new JournaledNotifier(
      { notify: () => Promise.resolve({ delivered: true, shouldLeave: true }) },
      (line) => {
        lines.push(line);
      },
    );

    const result = await notifier.notify({ kind: "door_waiting", meetingId: "m-1" });

    expect(result).toEqual({ delivered: true, shouldLeave: true });
    expect(lines).toEqual(["NOTICE door_waiting meeting_id=m-1 delivered=true should_leave=true"]);
  });

  it("сбой доставки пишется и пробрасывается, а не глотается", async () => {
    const failure = new Error("HTTP 502 upstream");
    const lines: string[] = [];
    const notifier = new JournaledNotifier({ notify: () => Promise.reject(failure) }, (line) => {
      lines.push(line);
    });

    await expect(notifier.notify({ kind: "captcha", meetingId: "m-1" })).rejects.toBe(failure);
    expect(lines).toEqual(["NOTICE captcha meeting_id=m-1 НЕ доставлено: HTTP 502 upstream"]);
  });
});
