// Классификация инструментов MCP: аннотации (ToolAnnotations, MCP 2025-03-26) и признак «в ответе текст людей».
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
  /** В ответе текст, написанный людьми: результат оборачивается в <untrusted_data> (untrusted.ts). */
  untrusted: boolean;
}

const read = (untrusted: boolean): ToolClass => ({ kind: "read", idempotent: true, untrusted });
const write = (idempotent: boolean): ToolClass => ({ kind: "write", idempotent, untrusted: false });
const destructive = (idempotent: boolean): ToolClass => ({ kind: "destructive", idempotent, untrusted: false });

export const TOOL_CLASSES: Record<string, ToolClass> = {
  // Чтение; текст людей внутри — оборачиваем.
  search_knowledge: read(true),
  get_tasks: read(true),
  get_meetings: read(true),
  get_feedback: read(true),
  get_entry: read(true),
  list_entries: read(true),
  get_task_comments: read(true),
  get_recent_comments: read(true),
  get_task_history: read(true),
  get_recent_task_changes: read(true),
  get_notifications: read(true),
  get_today_meetings: read(true),
  get_review_queue: read(true),
  get_draft_meeting: read(true),
  extract_tasks_from_meeting: read(true), // предлагает задачи по тезисам, сам ничего не создаёт
  get_inspections: read(true),
  get_inspection: read(true),
  market_get: read(true),
  get_sprints: read(true),
  get_sprint: read(true),
  get_sprint_journal: read(true),
  // Чтение; только служебные данные — без обёртки.
  whoami: read(false),
  get_users: read(false),
  get_projects: read(false),
  list_task_labels: read(false),
  get_task_stats: read(false),
  get_storage_stats: read(false),
  get_sprint_spaces: read(false),
  market_template: read(false),
  market_status: read(false),
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

/** Ответ инструмента несёт текст людей и должен идти в <untrusted_data>. */
export function isUntrustedResult(name: string): boolean {
  return Object.hasOwn(TOOL_CLASSES, name) && TOOL_CLASSES[name].untrusted;
}
