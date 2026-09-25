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
