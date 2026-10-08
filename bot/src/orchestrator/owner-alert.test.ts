import { describe, expect, it } from "vitest";

import { channelAlert, silenceAlertText } from "./owner-alert.ts";

describe("silenceAlertText — текст, утверждённый владельцем 08.10.2026", () => {
  it("тишина: название, площадка, запуск", () => {
    expect(
      silenceAlertText({ audio: "silent", title: "Синк", platform: "kontur", runId: "r-1" }),
    ).toBe(
      "⚠️ Scriba: в звонке «Синк» (Толк) 3 мин нет звука, запись сейчас пишет тишину. Запуск r-1.",
    );
    expect(
      silenceAlertText({ audio: "silent", title: "Синк", platform: "meet", runId: "r" }),
    ).toContain("(Meet)");
  });

  it("без названия и с незнакомой площадкой — честные заглушки", () => {
    expect(
      silenceAlertText({ audio: "silent", title: undefined, platform: "zoom", runId: "r" }),
    ).toContain("«встреча без названия» (zoom)");
    expect(
      silenceAlertText({ audio: "silent", title: "X", platform: undefined, runId: "r" }),
    ).toContain("(площадка неизвестна)");
  });

  it("звук вернулся", () => {
    expect(silenceAlertText({ audio: "back", title: "Синк", platform: "kontur", runId: "r" })).toBe(
      "✅ Scriba: звук в «Синк» вернулся.",
    );
  });
});

describe("channelAlert", () => {
  it("POST /notify с секретом и kind alert", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const send = channelAlert({
      url: "https://channel:8090",
      secret: "s3",
      fetch: (input, init) => {
        requests.push({ url: typeof input === "string" ? input : "не строка", init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    await send("текст");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://channel:8090/notify");
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer s3",
      "content-type": "application/json",
    });
    expect(JSON.parse(requests[0]?.init?.body as string)).toEqual({
      project: "scriba",
      kind: "alert",
      text: "текст",
    });
  });

  it("не 2xx — исключение с кодом", async () => {
    const send = channelAlert({
      url: "https://channel:8090/",
      secret: "s",
      fetch: () => Promise.resolve(new Response("", { status: 401 })),
    });

    await expect(send("т")).rejects.toThrow("канал FURCA ответил 401");
  });
});
