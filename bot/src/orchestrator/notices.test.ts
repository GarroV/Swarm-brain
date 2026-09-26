import { describe, expect, it } from "vitest";

import { LogNotifier, describeNotice } from "./notices.ts";

describe("нотисы до слияния notices", () => {
  it("строка журнала несёт вид, привязку и причину", () => {
    expect(describeNotice({ kind: "container_died", meetingId: "m-1", detail: "exit 137" })).toBe(
      'NOTICE container_died meeting_id=m-1 detail="exit 137"',
    );
    expect(describeNotice({ kind: "no_owner", meetingKey: "evt:2026-09-26" })).toBe(
      "NOTICE no_owner meeting_key=evt:2026-09-26",
    );
  });

  it("LogNotifier не молчит и честно говорит, что человек сообщения не получил", async () => {
    const lines: string[] = [];
    const notifier = new LogNotifier((line) => {
      lines.push(line);
    });

    const result = await notifier.notify({ kind: "door_waiting", meetingId: "m-1" });

    expect(result).toEqual({ delivered: false, shouldLeave: false });
    expect(lines).toEqual([
      "NOTICE door_waiting meeting_id=m-1 (НЕ доставлено: клиент meeting-notice ещё не подключён)",
    ]);
  });
});
