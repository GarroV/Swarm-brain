// Ключи строк виджета; обе локали передаются существующему useDt.
export const NEXT_TASK_TEXT: Record<"hint" | "meta" | "order" | "empty" | "reminderReason", [string, string]> = {
  hint: ["Пять моих задач с ближайшим сроком или напоминанием.", "My five tasks with the nearest due date or reminder."],
  meta: ["топ-5 по сроку и напоминанию", "top 5 by due date and reminder"],
  order: ["по сроку и напоминанию, просроченные первыми", "by due date and reminder, overdue first"],
  empty: ["Задач со сроком или напоминанием на вас нет", "No tasks with a due date or reminder on you"],
  reminderReason: ["Задача показана по напоминанию", "Shown because of its reminder"],
};
