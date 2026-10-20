// Причина, вписанная человеком в разделе «Спринты» (причина переноса `carry_reason` или заметка
// сверки `check_note`), автоматически становится комментарием в задаче — от его имени (решение
// владельца 19.10.2026, п.6: «когда мы в спринтах пишем причины — автоматом должен создаваться
// комментарий в задаче»). Уведомления — как у обычного комментария: тот же `afterTaskComment`
// (_shared/tasks/comment-fanout.ts), те же адресаты и тексты; решение о рассылке — владельца.
//
// Здесь решается «нужен ли комментарий и с каким текстом» (чистая `buildReasonComment`, под
// тестами) и создаётся сам комментарий (`postReasonComment`). Комментарий рождается только из
// текста, который вписал человек: автоматика (срок ушёл за конец спринта) причину не пишет.
// Создание самого комментария — `sprint-reason-post.ts` (там клиент базы; этот файл чистый).

import { COMMENT_MAX } from "./comments.ts";

export type ReasonLang = "ru" | "en";
export type ReasonField = "carry_reason" | "check_note";

export interface ReasonChange {
  field: ReasonField;
  /** Что стояло в поле до правки. */
  before: string | null;
  /** Что вписал человек; `null` или пусто — стёрли. */
  after: string | null;
  /** Отметка сверки строки (для метки «Сверка — риск»). */
  checkStatus: string | null;
}

const CHECK_LABEL: Record<ReasonLang, Record<string, string>> = {
  ru: { ok: "по плану", risk: "риск", problem: "проблема" },
  en: { ok: "on track", risk: "at risk", problem: "problem" },
};

function label(c: ReasonChange, lang: ReasonLang): string {
  if (c.field === "carry_reason") return lang === "ru" ? "Перенос" : "Carry-over";
  const base = lang === "ru" ? "Сверка" : "Check";
  const status = c.checkStatus ? CHECK_LABEL[lang][c.checkStatus] : undefined;
  return status ? `${base} — ${status}` : base;
}

/**
 * Текст комментария или `null`, если комментарий не нужен: поле стёрли (стирание старых не
 * удаляет и новых не создаёт) или текст остался прежним.
 */
export function buildReasonComment(c: ReasonChange, cycleName: string, lang: ReasonLang): string | null {
  const text = (c.after ?? "").trim();
  if (text === "") return null;
  if (text === (c.before ?? "").trim()) return null;
  const head = `${label(c, lang)} (${cycleName}): `;
  const room = COMMENT_MAX - head.length;
  return head + (text.length > room ? text.slice(0, room) : text);
}
