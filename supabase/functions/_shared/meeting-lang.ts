// Резолвинг языка встречи для транскрибации — чистая логика (без сети/БД, тестируется отдельно).
//
// Проблема: язык дорожки МИКРОФОНА раньше пинился ТОЛЬКО по системной дорожке (речь собеседника).
// В офлайн-встрече (один микрофон, sys-дорожки нет by design) якоря нет → Whisper авто-детектит
// тихий/русский микрофон как английский и транскрибирует по-английски (инцидент b8b7a609).
//
// Цепочка фолбэков (миграция БД НЕ нужна):
//   1. Надёжный sys-якорь — большинство языка по РЕАЛЬНЫМ sys-частям (не d.text-фолбэк,
//      не галлюцинация-only, не меньше MIN_ANCHOR_SEGMENTS сегментов). Тихая sys НЕ якорит.
//   2. Иначе — большинство по ВСЕМ реальным частям (sys+mic), взвешенно по числу сегментов.
//      Для офлайн-RU большинство mic-частей = russian → встреча остаётся русской.
//   3. Иначе — дефолт (env DEFAULT_MEETING_LANG, безопасно "ru" для этого деплоя).

// Whisper возвращает язык ИМЕНЕМ ("russian"/"english"), а параметр transcription.language ждёт
// ISO-639-1 ("ru"/"en"). Таблица расширена (не 15 строк, как раньше): реальный детект не должен
// молча дропаться в undefined только потому, что имя не в списке (тогда бы пин не ставился).
export const LANG_NAME_TO_CODE: Record<string, string> = {
  russian: "ru", english: "en", ukrainian: "uk", belarusian: "be", kazakh: "kk",
  uzbek: "uz", german: "de", french: "fr", spanish: "es", italian: "it",
  portuguese: "pt", polish: "pl", turkish: "tr", arabic: "ar", chinese: "zh",
  dutch: "nl", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi",
  czech: "cs", slovak: "sk", romanian: "ro", hungarian: "hu", greek: "el",
  bulgarian: "bg", serbian: "sr", croatian: "hr", slovenian: "sl", lithuanian: "lt",
  latvian: "lv", estonian: "et", hebrew: "he", hindi: "hi", japanese: "ja",
  korean: "ko", vietnamese: "vi", thai: "th", indonesian: "id", malay: "ms",
  persian: "fa", azerbaijani: "az", armenian: "hy", georgian: "ka", welsh: "cy",
  catalan: "ca", galician: "gl", tamil: "ta", urdu: "ur", tagalog: "tl",
};

// Обратная таблица ISO → имя (для дефолтного языка из env, заданного кодом).
export const CODE_TO_LANG_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(LANG_NAME_TO_CODE).map(([name, code]) => [code, name]),
);

export function langCode(name?: string): string | undefined {
  return name ? LANG_NAME_TO_CODE[name.toLowerCase()] : undefined;
}

// Минимум РЕАЛЬНЫХ сегментов, чтобы язык части учитывался в голосовании за язык встречи.
// Отсекает одиночный d.text-фолбэк и слишком короткие/ненадёжные части.
export const MIN_ANCHOR_SEGMENTS = 2;

// Голосующая проекция части (минимум для чистой логики; в проде — из Part).
export interface LangVotePart {
  track: "sys" | "mic";
  done: boolean;
  lang?: string; // имя языка от Whisper ("russian"/"english"/…)
  segmentCount: number; // число РЕАЛЬНЫХ сегментов после фильтра галлюцинаций
  viaFallback?: boolean; // сегменты пришли только из d.text-фолбэка (не настоящая речь)
}

// Часть даёт надёжный голос за язык только если реально произвела речь.
function isReliable(p: LangVotePart): boolean {
  return p.done && !!p.lang && !p.viaFallback && p.segmentCount >= MIN_ANCHOR_SEGMENTS;
}

// Большинство языка среди надёжных частей, взвешенно по числу сегментов. Пусто → undefined.
function majorityLang(parts: LangVotePart[]): string | undefined {
  const weight = new Map<string, number>();
  for (const p of parts) {
    if (!isReliable(p)) continue;
    weight.set(p.lang!, (weight.get(p.lang!) ?? 0) + p.segmentCount);
  }
  let best: string | undefined, bestN = 0;
  for (const [lang, n] of weight) if (n > bestN) { best = lang; bestN = n; }
  return best;
}

// Цепочка фолбэков (см. шапку). Возвращает ИМЯ языка (не ISO); дефолт — тоже имя.
export function resolveMeetingLang(parts: LangVotePart[], defaultLang: string): string {
  const sysAnchor = majorityLang(parts.filter((p) => p.track === "sys"));
  if (sysAnchor) return sysAnchor;
  const allMajority = majorityLang(parts);
  if (allMajority) return allMajority;
  return defaultLang;
}

// Какие части надо ПЕРЕтранскрибировать: реальные (есть сегменты), с языком, отличным от языка
// встречи. Возвращает индексы. Пустые/незавершённые/безъязыкие/совпадающие — пропускаются.
// Мы ПЕРЕтранскрибируем с пином языка встречи, а НЕ выбрасываем часть (дропать реальный транскрипт
// владельца хуже болезни).
export function partsNeedingRetranscribe(parts: LangVotePart[], resolvedLang: string): number[] {
  const out: number[] = [];
  parts.forEach((p, i) => {
    if (!p.done || !p.lang || p.segmentCount === 0) return;
    if (p.lang !== resolvedLang) out.push(i);
  });
  return out;
}
