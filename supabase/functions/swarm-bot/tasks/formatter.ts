import { sendInlineMessage } from "../lib/telegram.ts";
import type { Task } from "./types.ts";

export const STATUS_LABEL: Record<string, string> = {
  pending:     "⏳ На подтверждении",
  open:        "📌",
  in_progress: "🔄",
  done:        "✅",
  cancelled:   "❌",
  draft:       "📝",
};

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due + "T12:00:00");
  return `📅 до ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

export function formatTaskLine(task: Task): string {
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [country, due].filter(Boolean).join(" | ");
  return [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");
}

export async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length ? `👤 ${task.assignees.join(", ")}` : "";
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [who, country, due].filter(Boolean).join(" | ");
  const text = [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [[
    { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
    { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
    { text: "📅 Дедлайн", callback_data: `tdate_${task.id}` },
  ]]);
}

export async function sendPendingTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length ? `👤 ${task.assignees.join(", ")}` : "";
  const due = formatDue(task.due_date);
  const meta = [who, due].filter(Boolean).join(" · ");
  const text = [`⏳ <b>${task.title}</b>`, meta].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [[
    { text: "✅ Подтвердить", callback_data: `tc_${task.id}` },
    { text: "👤 Назначить", callback_data: `ta_${task.id}` },
    { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
  ]]);
}
