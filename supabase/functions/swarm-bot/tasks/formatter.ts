import { sendInlineMessage } from "../lib/telegram.ts";
import type { Task } from "./types.ts";
import { recurFreqLabelRu } from "../../_shared/tasks/recurrence.ts";

export const STATUS_LABEL: Record<string, string> = {
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

// Регулярная задача обязана быть видна ДО нажатия «Готово»: галочка её не закроет, а перенесёт
// на следующий раз, и без пометки человек жмёт кнопку с неверным ожиданием.
function formatRecur(task: Task): string {
  const label = recurFreqLabelRu(task.recur_freq);
  return label ? `🔁 ${label}` : "";
}

export function formatTaskLine(task: Task): string {
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [country, due, formatRecur(task)].filter(Boolean).join(" | ");
  return [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");
}

export async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length ? `👤 ${task.assignees.join(", ")}` : "";
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [who, country, due, formatRecur(task)].filter(Boolean).join(" | ");
  const text = [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [[
    { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
    { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
    { text: "📅 Дедлайн", callback_data: `tdate_${task.id}` },
  ]]);
}

