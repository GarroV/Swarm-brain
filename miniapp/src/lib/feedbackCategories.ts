// Зеркало кодов из supabase/functions/_shared/feedback-categories.ts.
// miniapp — отдельный пакет (Next.js), импортировать из edge-функций нельзя.
// При правке набора категорий синхронь ОБА места.
export const FEEDBACK_CATEGORIES = [
  { code: "recorder", label: "Рекордер" },
  { code: "meetings", label: "Встречи" },
  { code: "search", label: "Поиск" },
  { code: "tasks", label: "Задачи" },
  { code: "knowledge", label: "База знаний" },
  { code: "digest", label: "Дайджест" },
  { code: "auth", label: "Вход / доступ" },
  { code: "integrations", label: "Интеграции" },
  { code: "claude", label: "Claude / MCP" },
  { code: "ui", label: "Интерфейс" },
  { code: "other", label: "Другое" },
] as const;

export type FeedbackCategoryCode = (typeof FEEDBACK_CATEGORIES)[number]["code"];
