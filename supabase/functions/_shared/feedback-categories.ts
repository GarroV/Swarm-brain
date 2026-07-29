// Канон категорий и статусов фидбека. Единственный источник для бота, swarm-api и MCP.
// miniapp (отдельный пакет, Next.js) держит СВОЮ копию кодов — при правке синхронь оба места.

export const FEEDBACK_CATEGORIES = [
  { code: "recorder", label: "🎙 Рекордер" },
  { code: "meetings", label: "📝 Встречи" },
  { code: "search", label: "🔍 Поиск" },
  { code: "tasks", label: "✅ Задачи" },
  { code: "knowledge", label: "📚 База знаний" },
  { code: "digest", label: "📊 Дайджест" },
  { code: "auth", label: "🔑 Вход / доступ" },
  { code: "integrations", label: "🔌 Интеграции" },
  { code: "claude", label: "🤖 Claude / MCP" },
  { code: "ui", label: "🎨 Интерфейс" },
  { code: "other", label: "❓ Другое" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["code"];

export const FEEDBACK_CATEGORY_CODES: readonly string[] = FEEDBACK_CATEGORIES.map((c) => c.code);

export function isFeedbackCategory(code: unknown): code is FeedbackCategory {
  return typeof code === "string" && FEEDBACK_CATEGORY_CODES.includes(code);
}

export function feedbackCategoryLabel(code: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export const FEEDBACK_STATUSES = ["new", "triaged", "done", "wontfix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export function isFeedbackStatus(s: unknown): s is FeedbackStatus {
  return typeof s === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(s);
}
