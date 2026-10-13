// Запуск: deno test supabase/functions/_shared/telegram-outbox.test.ts
//
// Утренний разбор очереди комендантского часа: старые первыми, не больше потолка, неудача одной
// строки не блокирует остальных, на третьей неудаче строка сдаётся, ночью разбор не делает ничего.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { drainTelegramOutbox, type OutboxRow, type OutboxStore } from "./telegram-outbox.ts";

const MORNING = new Date("2026-10-14T06:00:00Z"); // 09:00 по Москве
const NIGHT = new Date("2026-10-14T05:00:00Z"); // 08:00 по Москве

const row = (id: number, attempts = 0): OutboxRow => ({
  id,
  recipient_id: id * 10,
  method: "sendMessage",
  payload: { chat_id: id * 10, text: `m${id}` },
  kind: "test",
  attempts,
});

function harness(rows: OutboxRow[], failFor: number[] = [], removed: number[] = []) {
  const sentIds: number[] = [];
  const failures: Array<{ id: number; attempts: number; error: string; giveUp: boolean }> = [];
  const calls: number[] = [];
  const limits: number[] = [];
  const store: OutboxStore = {
    enqueue: () => Promise.resolve(),
    members: (ids) => Promise.resolve(new Set(ids.filter((rid) => !removed.includes(rid / 10)))),
    unsent: (limit) => (limits.push(limit), Promise.resolve(rows.slice(0, limit))),
    markSent: (id) => (sentIds.push(id), Promise.resolve()),
    markFailed: (id, attempts, error, giveUp) => (failures.push({ id, attempts, error, giveUp }), Promise.resolve()),
  };
  const send = (_method: string, payload: Record<string, unknown>) => {
    const id = (payload.chat_id as number) / 10;
    calls.push(id);
    return failFor.includes(id) ? Promise.reject(new Error("Forbidden")) : Promise.resolve();
  };
  const sleeps: number[] = [];
  const sleep = (ms: number) => (sleeps.push(ms), Promise.resolve());
  return { store, send, sentIds, failures, calls, limits, sleeps, sleep };
}

Deno.test("утром отправляет старые первыми и помечает отправленные", async () => {
  const h = harness([row(1), row(2), row(3)]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: MORNING, sleep: h.sleep });
  assertEquals(res, { sent: 3, failed: 0, gaveUp: 0 });
  assertEquals(h.calls, [1, 2, 3]);
  assertEquals(h.sentIds, [1, 2, 3]);
  assertEquals(h.sleeps.length, 2); // пауза между сообщениями, не перед первым
});

Deno.test("в комендантский час разбор не делает ничего — даже не читает очередь", async () => {
  const h = harness([row(1)]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: NIGHT, sleep: h.sleep });
  assertEquals(res, { sent: 0, failed: 0, gaveUp: 0 });
  assertEquals(h.calls, []);
  assertEquals(h.limits, []);
});

Deno.test("неудача: attempts+1 и причина, остальные строки идут дальше", async () => {
  const h = harness([row(1), row(2, 1), row(3)], [2]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: MORNING, sleep: h.sleep });
  assertEquals(res, { sent: 2, failed: 1, gaveUp: 0 });
  assertEquals(h.sentIds, [1, 3]);
  assertEquals(h.failures, [{ id: 2, attempts: 2, error: "Forbidden", giveUp: false }]);
});

Deno.test("третья неудача — строка сдаётся (архив), не пятая и не вечный повтор", async () => {
  const h = harness([row(1, 2)], [1]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: MORNING, sleep: h.sleep });
  assertEquals(res, { sent: 0, failed: 1, gaveUp: 1 });
  assertEquals(h.failures, [{ id: 1, attempts: 3, error: "Forbidden", giveUp: true }]);
});

Deno.test("потолок за тик передаётся в выборку", async () => {
  const h = harness([row(1), row(2), row(3)]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: MORNING, sleep: h.sleep, limit: 2 });
  assertEquals(h.limits, [2]);
  assertEquals(res.sent, 2);
});

Deno.test("drain: получателя убрали из команды, пока сообщение ждало утра — не шлём, в архив", async () => {
  const h = harness([row(1), row(2)], [], [2]);
  const res = await drainTelegramOutbox({ store: h.store, send: h.send, now: MORNING, sleep: h.sleep });
  assertEquals(h.calls, [1]);
  assertEquals(h.sentIds, [1]);
  assertEquals(h.failures.map((f) => [f.id, f.giveUp]), [[2, true]]);
  assertEquals(res.gaveUp, 1);
});
