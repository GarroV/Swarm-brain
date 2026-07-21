export const COMMENT_MAX = 4000;

export function validateCommentContent(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Комментарий должен быть текстом" };
  const value = raw.trim();
  if (!value) return { ok: false, error: "Пустой комментарий" };
  if (value.length > COMMENT_MAX) return { ok: false, error: `Слишком длинно (макс ${COMMENT_MAX})` };
  return { ok: true, value };
}
