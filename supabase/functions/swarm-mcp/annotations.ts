// Классификация инструментов MCP: аннотации (ToolAnnotations, MCP 2025-03-26). Обёртка ответов — для всех (untrusted.ts).
// Одна карта на все инструменты: новый инструмент без записи здесь не пройдёт тест annotations.test.ts.
// Клиент показывает подтверждение по destructiveHint и не просит его для readOnlyHint (issue #967).

import type { ToolDefinition } from "./identity.ts";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

interface ToolClass {
  /** read — ничего не меняет; write — добавляет или правит; destructive — удаляет, архивирует, снимает, публикует. */
  kind: "read" | "write" | "destructive";
  idempotent: boolean;
}

const read = (): ToolClass => ({ kind: "read", idempotent: true });
const write = (idempotent: boolean): ToolClass => ({ kind: "write", idempotent });
const destructive = (idempotent: boolean): ToolClass => ({ kind: "destructive", idempotent });

export const TOOL_CLASSES: Record<string, ToolClass> = {
  // Чтение.
  search_knowledge: read(),
  get_tasks: read(),
  get_meetings: read(),
  get_feedback: read(),
  get_entry: read(),
  list_entries: read(),
  get_task_comments: read(),
  get_recent_comments: read(),
  get_task_history: read(),
  get_recent_task_changes: read(),
  get_notifications: read(),
  get_today_meetings: read(),
  get_review_queue: read(),
  get_draft_meeting: read(),
  extract_tasks_from_meeting: read(), // предлагает задачи по тезисам, сам ничего не создаёт
  get_inspections: read(),
  get_inspection: read(),
  market_get: read(),
  get_sprints: read(),
  get_sprint: read(),
  get_sprint_journal: read(),
  // Чтение (служебные данные).
  whoami: read(),
  get_users: read(),
  get_projects: read(),
  list_task_labels: read(),
  get_task_stats: read(),
  get_storage_stats: read(),
  get_sprint_spaces: read(),
  market_template: read(),
  market_status: read(),
  // Запись: добавляет или правит.
  add_knowledge: write(false),
  upload_file: write(false),
  update_entry: write(true),
  reindex_entry: write(true),
  resolve_feedback: write(true),
  add_task: write(false),
  update_task: write(true),
  add_task_comment: write(false),
  create_task_label: write(false),
  rename_task_label: write(true),
  set_task_subscription: write(true),
  mark_notifications_read: write(true),
  update_draft_meeting: write(true),
  create_sprint_space: write(false),
  create_sprint_group: write(false),
  rename_sprint_space: write(true),
  create_sprint: write(false),
  update_sprint: write(true),
  start_sprint: write(false),
  add_sprint_tasks: write(true),
  mark_sprint_task: write(true),
  move_sprint_task: write(false),
  market_set_block: write(true),
  market_set_company_year: write(true),
  market_upsert_location: write(true),
  market_upsert_chain: write(true),
  market_set_price: write(true),
  // Необратимое или убирающее: удаление, архив, снятие, приёмка спринта, публикация черновика.
  delete_entry: destructive(true),
  delete_task: destructive(true),
  delete_task_comment: destructive(true),
  delete_task_label: destructive(true),
  delete_sprint: destructive(true),
  archive_sprint_space: destructive(true),
  remove_sprint_task: destructive(true),
  accept_sprint: destructive(false),
  publish_draft_meeting: destructive(false),
};

/** Аннотации инструмента по карте; undefined — инструмент не классифицирован. */
export function annotationsFor(name: string): ToolAnnotations | undefined {
  const cls = Object.hasOwn(TOOL_CLASSES, name) ? TOOL_CLASSES[name] : undefined;
  if (!cls) return undefined;
  return {
    readOnlyHint: cls.kind === "read",
    destructiveHint: cls.kind === "destructive",
    idempotentHint: cls.idempotent,
    openWorldHint: false,
  };
}

/** Копия определения с annotations. Незнакомый инструмент получает самые осторожные: запись, разрушающая. */
export function withAnnotations<T extends ToolDefinition>(tool: T): T & { annotations: ToolAnnotations } {
  return {
    ...tool,
    annotations: annotationsFor(tool.name) ??
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  };
}
