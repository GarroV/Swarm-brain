import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type FeedbackPingDeps,
  sendFeedbackPing,
  TELEGRAM_CAPTION_LIMIT,
  type TelegramResult,
} from "./feedback-ping.ts";

type Call = { method: string; payload: Record<string, unknown> };

function fakeDeps(opts: {
  signed?: string | null;
  answer?: (c: Call) => TelegramResult;
}): FeedbackPingDeps & { calls: Call[]; saved: string[] } {
  const calls: Call[] = [];
  const saved: string[] = [];
  return {
    calls,
    saved,
    fileUrl: () => Promise.resolve(opts.signed === undefined ? "https://storage.example/signed?token=t" : opts.signed),
    call: (method, payload) => {
      const c = { method, payload };
      calls.push(c);
      return Promise.resolve(opts.answer ? opts.answer(c) : { ok: true });
    },
    saveChannelId: (id) => {
      saved.push(id);
      return Promise.resolve();
    },
  };
}

Deno.test("feedback-ping: скрин уходит подписанной ссылкой, а не путём в бакете", async () => {
  const deps = fakeDeps({});
  const r = await sendFeedbackPing(deps, { chatId: "-100", text: "bug", screenshotPath: "feedback/2026-10-01_x.png" });
  assertEquals(r, { ok: true, photo: true });
  assertEquals(deps.calls.length, 1);
  assertEquals(deps.calls[0].method, "sendPhoto");
  assertEquals(deps.calls[0].payload.photo, "https://storage.example/signed?token=t");
});

Deno.test("feedback-ping: Telegram отверг фото — отзыв всё равно уходит текстом", async () => {
  const deps = fakeDeps({
    answer: (c) => c.method === "sendPhoto" ? { ok: false, description: "wrong file" } : { ok: true },
  });
  const r = await sendFeedbackPing(deps, { chatId: "-100", text: "bug", screenshotPath: "feedback/a.png" });
  assertEquals(r, { ok: true, photo: false });
  assertEquals(deps.calls.map((c) => c.method), ["sendPhoto", "sendMessage"]);
});

Deno.test("feedback-ping: не удалось подписать скрин — только текст", async () => {
  const deps = fakeDeps({ signed: null });
  const r = await sendFeedbackPing(deps, { chatId: "-100", text: "bug", screenshotPath: "feedback/a.png" });
  assertEquals(r, { ok: true, photo: false });
  assertEquals(deps.calls.map((c) => c.method), ["sendMessage"]);
});

Deno.test("feedback-ping: подпись длиннее предела — текст отдельно, фото без подписи", async () => {
  const deps = fakeDeps({});
  const text = "x".repeat(TELEGRAM_CAPTION_LIMIT + 1);
  await sendFeedbackPing(deps, { chatId: "-100", text, screenshotPath: "feedback/a.png" });
  assertEquals(deps.calls.map((c) => c.method), ["sendMessage", "sendPhoto"]);
  assertEquals(deps.calls[1].payload.caption, undefined);
});

Deno.test("feedback-ping: отказ Telegram — результат не ok (не молчаливый успех)", async () => {
  const deps = fakeDeps({ answer: () => ({ ok: false, description: "chat not found" }) });
  const r = await sendFeedbackPing(deps, { chatId: "-100", text: "bug" });
  assertEquals(r, { ok: false, error: "chat not found" });
});

Deno.test("feedback-ping: канал переехал в супергруппу — id сохраняется, пинг повторяется", async () => {
  const deps = fakeDeps({
    answer: (c) => c.payload.chat_id === "-100" ? { ok: false, migrateToChatId: "-200" } : { ok: true },
  });
  const r = await sendFeedbackPing(deps, { chatId: "-100", text: "bug" });
  assertEquals(r.ok, true);
  assertEquals(deps.saved, ["-200"]);
  assertEquals(deps.calls.map((c) => c.payload.chat_id), ["-100", "-200"]);
});
