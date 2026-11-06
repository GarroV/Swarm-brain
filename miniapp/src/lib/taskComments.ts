// Правила комментария на стороне веба — те же, что у сервера (`_shared/tasks/comments.ts`).
//
// Зачем дублировать предел, раз сервер всё равно проверит: отказ должен приходить, пока текст
// ещё в поле и его видно, а не после отправки. До issue #445 сервер отвечал «Слишком длинно»,
// а экран показывал «Не удалось отправить» — человек не понимал, что надо сократить, и решал,
// что большие комментарии просто не работают.
//
// ⚠️ Значение зеркалит COMMENT_MAX сервера. Меняешь здесь — меняй и там (и наоборот).

/** Предел длины комментария — решение владельца 22.09.2026: вмещает лонг-пост из телеграма. */
export const COMMENT_MAX = 20_000;

/** Осталось меньше этого — показываем счётчик: предел близко, но текст ещё не потерян. */
export const COMMENT_WARN_LEFT = 1_000;

/** Длиннее этого комментарий в ленте сворачивается: иначе простыня хоронит соседние. */
export const COMMENT_COLLAPSE_AT = 1_200;

/** Shared task comment UI; language follows the existing demo-only language context. */
export const TASK_COMMENTS_COPY = {
  ru: {
    heading: "Комментарии",
    inputLabel: "Комментарий",
    placeholder: "Написать апдейт…  (Enter — отправить)",
    empty: "Пока нет комментариев.",
    send: "Отправить",
    sendHint: "Отправить (Enter)",
    remove: "Удалить комментарий",
    loadError: "Не удалось загрузить комментарии",
    removeError: "Не удалось удалить",
  },
  en: {
    heading: "Comments",
    inputLabel: "Comment",
    placeholder: "Write an update…  (Enter to send)",
    empty: "No comments yet.",
    send: "Send",
    sendHint: "Send (Enter)",
    remove: "Delete comment",
    loadError: "Could not load comments",
    removeError: "Could not delete",
  },
} as const;

/**
 * Начало длинного комментария для свёрнутого вида. Режем по концу строки, если он близко
 * к порогу: обрыв посреди слова или ссылки читается как порча текста, а не как «свёрнуто».
 */
export function collapsePreview(text: string): string {
  if (text.length <= COMMENT_COLLAPSE_AT) return text;
  const nl = text.lastIndexOf("\n", COMMENT_COLLAPSE_AT);
  const end = nl > COMMENT_COLLAPSE_AT / 2 ? nl : COMMENT_COLLAPSE_AT;
  return text.slice(0, end).trimEnd();
}
