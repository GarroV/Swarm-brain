// Хелперы черновика встречи (рекордер). Без зависимостей — тест гоняется на Deno:
//   deno test --allow-read miniapp/src/lib/agentMeeting.test.ts

/**
 * Готовы ли тезисы черновика — по ЛЮБОЙ из двух форм ответа.
 *
 * Списочный GET /agent-meetings не отдаёт сам текст (issue #108: он ехал в 10-секундном
 * поллинге, 154 кБ за опрос), а отдаёт признак `has_draft_notes`. Деталь
 * GET /agent-meetings/:id отдаёт текст и признака не ставит. Экраны получают то одну форму,
 * то другую — поэтому проверка наличия живёт здесь, а не размазана по компонентам через
 * `m.draft_notes_md === null`, что на списочной форме давало бы ложное «готовим тезисы…».
 *
 * Флаг приоритетнее текста; когда неизвестно ничего — fail-closed «не готово» (показываем
 * «готовим…», а не обещаем тезисы, которых может не быть).
 */
export function hasDraftNotes(m: { has_draft_notes?: boolean; draft_notes_md?: string | null }): boolean {
  if (typeof m.has_draft_notes === "boolean") return m.has_draft_notes;
  return (m.draft_notes_md ?? "").trim().length > 0;
}
