// Запуск: deno test supabase/functions/_shared/notify-person.test.ts
//
// Комендантский час (решение владельца 13.10.2026): в 23:00–9:00 по Москве сообщение человеку
// не уходит, а ложится в очередь; днём уходит сразу. Ошибка здесь молчит в обе стороны —
// ночное сообщение будит человека или дневное пропадает в очереди, — поэтому проверяем и то, и то.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverOrQueue } from "./notify-person.ts";
import type { OutboxMessage, OutboxStore } from "./telegram-outbox.ts";

const NIGHT = new Date("2026-10-13T22:30:00Z"); // 01:30 по Москве
const DAY = new Date("2026-10-14T06:00:00Z"); // 09:00 по Москве

function harness(failSend = false) {
  const queued: OutboxMessage[] = [];
  const sent: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const store = {
    enqueue: (m: OutboxMessage) => (queued.push(m), Promise.resolve()),
  } as unknown as OutboxStore;
  const send = (method: string, payload: Record<string, unknown>) => {
    if (failSend) return Promise.reject(new Error("Telegram API: Forbidden: bot was blocked by the user"));
    sent.push({ method, payload });
    return Promise.resolve();
  };
  return { deps: { store, send }, queued, sent };
}

const request = {
  recipientId: 42,
  kind: "digest",
  payload: { text: "привет", parse_mode: "HTML" },
};

Deno.test("днём сообщение уходит сразу, очередь пуста", async () => {
  const { deps, queued, sent } = harness();
  const result = await deliverOrQueue(deps, request, DAY);
  assertEquals(result, "sent");
  assertEquals(queued, []);
  assertEquals(sent, [{ method: "sendMessage", payload: { chat_id: 42, text: "привет", parse_mode: "HTML" } }]);
});

Deno.test("в комендантский час сообщение не уходит, а ложится в очередь целиком", async () => {
  const { deps, queued, sent } = harness();
  const result = await deliverOrQueue(deps, request, NIGHT);
  assertEquals(result, "queued");
  assertEquals(sent, []);
  assertEquals(queued, [{
    recipient_id: 42,
    method: "sendMessage",
    payload: { chat_id: 42, text: "привет", parse_mode: "HTML" },
    kind: "digest",
  }]);
});

Deno.test("метод Bot API сохраняется в очереди", async () => {
  const { deps, queued } = harness();
  await deliverOrQueue(deps, { ...request, method: "sendDocument" }, NIGHT);
  assertEquals(queued[0].method, "sendDocument");
});

Deno.test("сбой Telegram днём — исключение, а не молчаливый успех и не очередь", async () => {
  const { deps, queued } = harness(true);
  await assertRejects(() => deliverOrQueue(deps, request, DAY), Error, "blocked");
  assertEquals(queued, []);
});
