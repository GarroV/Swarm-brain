// Предел длины комментария к задаче. 20 000 знаков — решение владельца 22.09.2026 (issue #445):
// комментарий должен вмещать целиком «лонг пост из телеграма». Прежние 4000 были санитарным
// пределом из плана фичи 21.07.2026, без технического обоснования, и люди в них упирались.
//
// Почему предел вообще остаётся, раз колонка `content` типа text (Postgres держит до 1 ГБ):
// лента комментариев отдаётся одним запросом целиком, без пагинации, — произвольная длина
// означала бы мегабайты на каждом открытии задачи.
export const COMMENT_MAX = 20_000;

export function validateCommentContent(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Комментарий должен быть текстом" };
  }
  const value = raw.trim();
  if (!value) return { ok: false, error: "Пустой комментарий" };
  if (value.length > COMMENT_MAX) {
    // Называем и фактическую длину, и предел: «слишком длинно» без цифр не говорит,
    // насколько сокращать, и человек режет наугад.
    return {
      ok: false,
      error: `Слишком длинно: ${value.length} знаков, максимум ${COMMENT_MAX}`,
    };
  }
  return { ok: true, value };
}

// Кто может удалить комментарий. Одно правило для веба (swarm-api/task-comments.ts) и MCP:
// автор — всегда, админ — только там, где ему дан пригляд (веб). В MCP админский обход не
// передаётся: агент от имени владельца не должен сносить чужие апдейты по ошибке (issue #515).
// Возвращает текст отказа или null.
export function commentDeleteDenial(
  authorTelegramId: number | null,
  callerTelegramId: number,
  allowAdminOverride: boolean,
): string | null {
  if (authorTelegramId === callerTelegramId) return null;
  if (allowAdminOverride) return null;
  return "Нельзя удалить чужой комментарий";
}
