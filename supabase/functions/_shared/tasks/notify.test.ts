// Запуск: deno test supabase/functions/_shared/tasks/notify.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commentRecipients, isCommentRecipient, type NotifiableTask } from "./notify.ts";

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

// ── Подписки (issue #82, решение владельца 2026-08-24) ────────────────────────
// Канон: docs/decisions/2026-08-24-comment-subscription.md

const sub = (id: number, state: "subscribed" | "muted", is_admin = false) => ({ telegram_id: id, state, is_admin });

Deno.test("подписчик получает уведомление, даже если к задаче не причастен", () => {
  const t = task({ assignee_telegram_ids: [1] });
  assertEquals(commentRecipients(t, 99, [sub(5, "subscribed")]), [1, 5]);
});

Deno.test("отписавшийся не получает, даже будучи исполнителем — явный отказ сильнее умолчания", () => {
  const t = task({ assignee_telegram_ids: [1, 2], created_by_telegram_id: 3 });
  assertEquals(commentRecipients(t, 99, [sub(2, "muted")]), [1, 3]);
});

Deno.test("отписка владельца задачи тоже уважается", () => {
  const t = task({ owner_id: 4, assignee_telegram_ids: [1] });
  assertEquals(commentRecipients(t, 99, [sub(4, "muted")]), [1]);
});

Deno.test("АДМИН, подписанный на личную задачу, уведомление получает (оверсайт у него уже есть)", () => {
  const t = task({ is_private: true, owner_id: 4, assignee_telegram_ids: [1] });
  assertEquals(commentRecipients(t, 99, [sub(7, "subscribed", true)]), [4, 7]);
});

Deno.test("НЕ админ, подписанный на чужую личную задачу, уведомления НЕ получает", () => {
  const t = task({ is_private: true, owner_id: 4 });
  assertEquals(commentRecipients(t, 99, [sub(7, "subscribed", false)]), [4]);
});

Deno.test("оверсайт НЕ протекает в круг по умолчанию: админ без подписки не получает чужую личную", () => {
  const t = task({ is_private: true, owner_id: 4, assignee_telegram_ids: [7] });
  // 7 — исполнитель и админ, но подписки нет → правило по умолчанию, isAdmin=false
  assertEquals(commentRecipients(t, 99, []), [4]);
});

Deno.test("автор комментария не уведомляется даже будучи подписанным", () => {
  const t = task({ assignee_telegram_ids: [1] });
  assertEquals(commentRecipients(t, 5, [sub(5, "subscribed")]), [1]);
});

Deno.test("подписчик-дубликат причастного не задваивается", () => {
  const t = task({ assignee_telegram_ids: [1], created_by_telegram_id: 2 });
  assertEquals(commentRecipients(t, 99, [sub(1, "subscribed"), sub(2, "subscribed")]), [1, 2]);
});

Deno.test("isCommentRecipient: три слоя по отдельности", () => {
  const open = task({ assignee_telegram_ids: [1] });
  const priv = task({ is_private: true, owner_id: 4 });
  // muted гасит причастного
  assertEquals(isCommentRecipient(open, 1, { subscription: "muted" }), false);
  // подписка добавляет непричастного
  assertEquals(isCommentRecipient(open, 9, { subscription: "subscribed" }), true);
  assertEquals(isCommentRecipient(open, 9, {}), false);
  // подписка не открывает чужую личную не-админу, но открывает админу
  assertEquals(isCommentRecipient(priv, 9, { subscription: "subscribed" }), false);
  assertEquals(isCommentRecipient(priv, 9, { subscription: "subscribed", isAdmin: true }), true);
});
