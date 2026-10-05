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

export type RecordedBy = "scriba" | "bumblebee";

/**
 * Чем записана встреча: ботом встреч (scriba) или рекордером на Mac (bumblebee). Решение владельца
 * 03.10.2026 «надо различать бамблби и скрибу» (#788): раньше подпись «bumblebee» стояла на всём.
 *
 * Источник истины — `recorded_by`: его ставит сервер, когда пишет стенограмму, — то есть это тот,
 * чья запись в итоге легла в базу. Пока стенограммы нет, но строку завёл бот (`agent_version`
 * scriba-…), встречу пишет бот. Иначе — рекордер. Встреча не из рекордера/бота — null.
 */
export function recordedByOf(m: {
  source?: string | null;
  recorded_by?: string | null;
  agent_version?: string | null;
}): RecordedBy | null {
  if (m.source !== "desktop-agent" && m.source !== "swarm-recorder") return null;
  if (m.recorded_by === "scriba" || m.recorded_by === "bumblebee") return m.recorded_by;
  return m.agent_version?.startsWith("scriba-") ? "scriba" : "bumblebee";
}
