// Подпись говорящего в транскрипте вычитки (issue #819).
//
// Метку пишет сервер (`_shared/speakers.ts`): бот встреч знает имена из звонка, а рекордер на Mac
// пишет две дорожки и различает только «я» (микрофон) и «собеседник» (звук звонка) — кто именно
// говорит в звонке, у него узнать неоткуда. «Я» здесь — тот, кто записывал: подставляем его имя,
// если записавший один. Подпись ставится только при смене говорящего, иначе она повторялась бы
// в каждой строке монолога.

const ME = "я";
const OTHER = "собеседник";

export function speakerName(raw: string | null | undefined, opts: { meName: string | null; lang: "ru" | "en" }): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s === ME) return opts.meName ?? (opts.lang === "ru" ? "Я" : "Me");
  if (s === OTHER) return opts.lang === "ru" ? "Собеседник" : "Other side";
  return s;
}

/** Подпись для строки `i`: имя, если говорящий сменился, иначе null. */
export function speakerLabelAt(
  segments: ReadonlyArray<{ speaker?: string }>,
  i: number,
  opts: { meName: string | null; lang: "ru" | "en" },
): string | null {
  const cur = segments[i]?.speaker?.trim() || null;
  const prev = i > 0 ? segments[i - 1]?.speaker?.trim() || null : null;
  if (cur === null || cur === prev) return null;
  return speakerName(cur, opts);
}
