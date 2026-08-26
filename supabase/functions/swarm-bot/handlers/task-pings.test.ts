// Запуск: deno test supabase/functions/swarm-bot/handlers/task-pings.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatPings,
  groupByRecipient,
  isPingDue,
  pingRecipients,
  todayIn,
  type PingRow,
} from "./task-pings.ts";

const row = (over: Partial<PingRow> = {}): PingRow => ({
  id: "t1",
  title: "Замер температуры",
  remind_date: "2026-08-26",
  due_date: "2026-09-20",
  status: "open",
  is_private: false,
  assignee_telegram_ids: [111],
  created_by_telegram_id: 222,
  remind_set_by: null,
  owner_id: null,
  ...over,
});

Deno.test("todayIn: календарный день считается по Белграду, а не по UTC", () => {
  // 22:30 UTC = 00:30 следующего дня в Белграде (CEST, +2).
  assertEquals(todayIn(new Date("2026-08-25T22:30:00Z")), "2026-08-26");
});

Deno.test("isPingDue: пинг на сегодня — пора", () => {
  assertEquals(isPingDue(row(), "2026-08-26"), true);
});

Deno.test("isPingDue: пинг в будущем — рано", () => {
  assertEquals(isPingDue(row(), "2026-08-25"), false);
});

Deno.test("isPingDue: пропущенный пинг из прошлого всё равно отдаётся (крон мог простоять)", () => {
  assertEquals(isPingDue(row({ remind_date: "2026-08-20" }), "2026-08-26"), true);
});

Deno.test("isPingDue: без даты пинга — нет", () => {
  assertEquals(isPingDue(row({ remind_date: null }), "2026-08-26"), false);
});

Deno.test("isPingDue: закрытая задача не пингует (оба написания статуса)", () => {
  assertEquals(isPingDue(row({ status: "done" }), "2026-08-26"), false);
});

Deno.test("pingRecipients: пинг идёт исполнителям", () => {
  assertEquals(pingRecipients(row({ assignee_telegram_ids: [111, 333] })), [111, 333]);
});

Deno.test("pingRecipients: у общей задачи без исполнителя — тому, кто поставил пинг", () => {
  assertEquals(pingRecipients(row({ assignee_telegram_ids: [], remind_set_by: 999 })), [999]);
});

Deno.test("pingRecipients: поставившего пинга нет — падаем на создателя задачи", () => {
  assertEquals(pingRecipients(row({ assignee_telegram_ids: [], remind_set_by: null })), [222]);
});

Deno.test("pingRecipients: приватная задача — ТОЛЬКО владельцу, даже если назначена на другого", () => {
  const r = row({ is_private: true, owner_id: 111, assignee_telegram_ids: [111, 333], created_by_telegram_id: 333 });
  assertEquals(pingRecipients(r), [111]);
});

Deno.test("pingRecipients: приватная задача, назначенная другому — пинг уходит владельцу, а не в пустоту", () => {
  // Исполнитель 111 приватную задачу НЕ видит (владелец 222). Если бы круг остался пустым,
  // пинг молча не ушёл бы никому, а задача навсегда осталась бы в выборке крона.
  const r = row({ is_private: true, owner_id: 222, assignee_telegram_ids: [111], created_by_telegram_id: 333 });
  assertEquals(pingRecipients(r), [222]);
});

Deno.test("pingRecipients: получателя нет вовсе — пустой круг (крон такой пинг гасит)", () => {
  const r = row({ assignee_telegram_ids: [], remind_set_by: null, created_by_telegram_id: null });
  assertEquals(pingRecipients(r), []);
});

Deno.test("pingRecipients: дубли получателей схлопываются", () => {
  assertEquals(pingRecipients(row({ assignee_telegram_ids: [111, 111] })), [111]);
});

Deno.test("groupByRecipient: задача с двумя исполнителями попадает обоим", () => {
  const groups = groupByRecipient([row({ assignee_telegram_ids: [111, 333] })]);
  assertEquals([...groups.keys()], [111, 333]);
  assertEquals(groups.get(111)?.length, 1);
});

Deno.test("formatPings: одна задача — заголовок, срок и кнопка на неё", () => {
  const { text, keyboard } = formatPings([row()], "https://swarm.example");
  assertEquals(text.includes("Замер температуры"), true);
  assertEquals(text.includes("20 сен"), true);
  assertEquals(keyboard.length, 1);
  assertEquals(keyboard[0][0].url, "https://swarm.example/?task=t1");
});

Deno.test("formatPings: без срока не выдумываем дату", () => {
  const { text } = formatPings([row({ due_date: null })], "https://swarm.example");
  assertEquals(text.includes("срок"), false);
});

Deno.test("formatPings: без адреса веба кнопок нет, список остаётся в тексте", () => {
  const { text, keyboard } = formatPings([row(), row({ id: "t2", title: "Вторая" })], "");
  assertEquals(keyboard.length, 0);
  assertEquals(text.includes("Вторая"), true);
});
