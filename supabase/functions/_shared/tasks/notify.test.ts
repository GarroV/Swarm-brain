// Запуск: deno test supabase/functions/_shared/tasks/notify.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commentRecipients, type NotifiableTask } from "./notify.ts";

const task = (over: Partial<NotifiableTask> = {}): NotifiableTask => ({
  assignee_telegram_ids: [],
  created_by_telegram_id: null,
  owner_id: null,
  is_private: false,
  ...over,
});

Deno.test("commentRecipients: исполнители + создатель + владелец", () => {
  const t = task({ assignee_telegram_ids: [1, 2], created_by_telegram_id: 3, owner_id: 4 });
  assertEquals(commentRecipients(t, 99), [1, 2, 3, 4]);
});

Deno.test("commentRecipients: автор комментария себе не шлёт", () => {
  const t = task({ assignee_telegram_ids: [1, 2], created_by_telegram_id: 3 });
  assertEquals(commentRecipients(t, 2), [1, 3]);
});

Deno.test("commentRecipients: дубликаты схлопываются", () => {
  const t = task({ assignee_telegram_ids: [7, 7], created_by_telegram_id: 7, owner_id: 7 });
  assertEquals(commentRecipients(t, 99), [7]);
});

Deno.test("commentRecipients: null/пустые поля игнорируются", () => {
  assertEquals(commentRecipients(task(), 99), []);
  assertEquals(commentRecipients(task({ assignee_telegram_ids: null }), 99), []);
});

// Приватную задачу видит ТОЛЬКО владелец (`canViewTask`). Уведомление исполнителю,
// который задачу открыть не может, показало бы ему заголовок — это утечка.
Deno.test("commentRecipients: приватная задача — только владелец", () => {
  const t = task({ is_private: true, assignee_telegram_ids: [1, 2], created_by_telegram_id: 3, owner_id: 4 });
  assertEquals(commentRecipients(t, 99), [4]);
});

Deno.test("commentRecipients: приватная задача, комментирует владелец → никому", () => {
  const t = task({ is_private: true, assignee_telegram_ids: [1], owner_id: 4 });
  assertEquals(commentRecipients(t, 4), []);
});

// Осиротевшая приватная задача (owner_id = null) закрыта для всех — fail-closed, как в access.ts.
Deno.test("commentRecipients: приватная без владельца → никому", () => {
  const t = task({ is_private: true, assignee_telegram_ids: [1], created_by_telegram_id: 3 });
  assertEquals(commentRecipients(t, 99), []);
});
