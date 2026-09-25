// Форматирование ответов MCP-инструментов вычитки черновиков встреч (issue #513).
// Чистые функции — проверяются без базы.

export type QueueRow = {
  id: string;
  title: string | null;
  started_at: string | null;
  source: string | null;
  draft_notes_md: string | null;
};

export function formatReviewQueue(rows: QueueRow[], total: number | null): string {
  if (!rows.length) return "Очередь вычитки пуста: черновиков, ждущих тебя, нет.";
  const lines = rows.map((r) => {
    const date = r.started_at ? r.started_at.slice(0, 16).replace("T", " ") : "без даты";
    const notes = r.draft_notes_md ? "тезисы готовы" : "тезисы ещё не готовы";
    return `• ${r.title?.trim() || "Без названия"} — ${date} UTC, ${notes}\n  id: ${r.id}`;
  });
  const head = `Черновиков на вычитке: ${total ?? rows.length}`;
  // Выдача обрезана — говорим прямо, иначе агент решит, что разобрал всё.
  const tail = total != null && total > rows.length
    ? `\n\n⚠️ Показаны ${rows.length} из ${total}, самые свежие.`
    : "";
  return `${head}\n\n${lines.join("\n\n")}${tail}`;
}

export type DraftRow = QueueRow & {
  status: string;
  attendees?: Array<{ name?: string; email?: string }> | null;
};

export function formatDraftMeeting(m: DraftRow): string {
  const who = (m.attendees ?? [])
    .map((a) => a.name?.trim() || a.email?.trim())
    .filter(Boolean)
    .join(", ");
  const date = m.started_at ? m.started_at.slice(0, 16).replace("T", " ") + " UTC" : "без даты";
  const state = m.status === "in_base" ? "уже опубликован в базе" : "на вычитке";
  return [
    `Название: ${m.title?.trim() || "Без названия"}`,
    `Когда: ${date}`,
    `Статус: ${state}`,
    `Участники: ${who || "—"}`,
    `id: ${m.id}`,
    "",
    "Тезисы:",
    m.draft_notes_md?.trim() || "(ещё не готовы)",
  ].join("\n");
}

export function formatPublishOutcome(entry: Record<string, unknown>, status: number): string {
  const id = entry.id as string | undefined;
  // Публикация склеилась с уже лежащей в базе встречей — человеку важно знать, чья версия осталась.
  if (entry.duplicate === true) {
    return entry.replaced === true
      ? `✅ Встреча уже была в базе — твоя версия полнее и заменила прежнюю. Запись: ${id}`
      : `✅ Встреча уже была в базе, там осталась прежняя версия (она полнее). Черновик привязан к ней. Запись: ${id}`;
  }
  if (status === 200) return `✅ Черновик уже был опубликован. Запись: ${id}`;
  const where = entry.is_private === true ? "в личную базу" : "в базу команды";
  return `✅ Опубликовано ${where}. Запись: ${id}`;
}

export type ProposedTask = {
  title: string;
  description?: string | null;
  assignee?: string | null;
  due_date?: string | null;
  country?: string | null;
  /** Кто из команды нашёлся по имени; null — не нашёлся или имя не названо. */
  resolved_assignee?: string | null;
};

// Предложения, а не созданные задачи: агент показывает их человеку и заводит через add_task.
// Исполнитель не нашёлся → задача на того, кто разбирает (решение владельца 2026-08-28,
// docs/decisions/2026-08-28-assignee-falls-back-to-author.md) — говорим это прямо, иначе
// агент заведёт ничью задачу, которая выпадет мимо «Сегодня» и «Мои» (инцидент #151).
export function formatProposedTasks(tasks: ProposedTask[], callerName: string): string {
  if (!tasks.length) return "В тезисах не нашлось поручений с конкретным результатом.";
  const lines = tasks.map((t, i) => {
    const who = t.resolved_assignee
      ? t.resolved_assignee
      : t.assignee
      ? `${callerName} (в тезисах «${t.assignee}», в команде не нашёлся)`
      : `${callerName} (исполнитель не назван)`;
    const parts = [
      `${i + 1}. ${t.title}`,
      t.description ? `   ${t.description}` : null,
      `   Исполнитель: ${who}`,
      `   Срок: ${t.due_date ?? "—"} · Рынок: ${t.country ?? "—"}`,
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    `Предложено задач: ${tasks.length}. Ничего не создано — покажи список человеку и заведи согласованные через add_task.`,
    "",
    lines.join("\n\n"),
  ].join("\n");
}
