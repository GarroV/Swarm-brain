// Резолвинг языка встречи для транскрибации — чистая логика (без сети/БД, тестируется отдельно).
//
// ЯЗЫК-НЕЙТРАЛЬНО и БЕЗ БАЙАСА: язык встречи выводится из САМОГО аудио, а не из дефолта.
// Русская встреча → русский, английская → английский — решает то, на каком языке РЕАЛЬНО
// говорили дольше всего.
//
// Проблема, которую это чинит: Whisper определяет язык по первым ~30с КАЖДОГО чанка. Офлайн-записи
// часто начинаются с тишины → такой чанк авто-детектится как английский (дефолт Whisper на
// неоднозначном входе) и транскрибирует иноязычную речь по-английски. Чанки с реальной речью
// детектятся правильно.
//
// Решение — голосование, ВЗВЕШЕННОЕ ПО ОБЪЁМУ РЕАЛЬНОЙ РЕЧИ (число символов транскрипта), по ВСЕМ
// частям (mic+sys). Чанк-тишина, мис-детектнутый как английский (или галлюцинация-«аутро»), несёт
// почти ноль реальных символов → не может перебить чанки, где реально говорили. Побеждает язык с
// наибольшим числом символов реальной речи. Никакого форс-дефолта: если реальной речи нет вообще —
// возвращаем undefined (пина нет, отдаём Whisper его собственный по-чанковый автодетект).

// Whisper возвращает язык ИМЕНЕМ ("russian"/"english"), а параметр transcription.language ждёт
// ISO-639-1 ("ru"/"en"). Таблица широкая: реальный детект не должен молча дропаться в undefined
// только потому, что имя не в списке (тогда бы пин не ставился).
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

export function langCode(name?: string): string | undefined {
  return name ? LANG_NAME_TO_CODE[name.toLowerCase()] : undefined;
}

// Минимум РЕАЛЬНЫХ символов речи, чтобы язык части учитывался в голосовании. Отсекает near-empty
// части (крохи после фильтра галлюцинаций / одиночный короткий d.text-фолбэк). Основной рычаг —
// само взвешивание по символам; это лишь пол, чтобы негодная кроха не голосовала.
export const MIN_REAL_CHARS = 20;

// Голосующая проекция части (минимум для чистой логики; в проде — из Part). Трек (mic/sys) в голосе
// НЕ участвует — голосование язык-нейтрально по объёму речи; собеседник (sys) с реальной речью и так
// побеждает по символам, а тихий/галлюцинированный sys исключён порогом и viaFallback.
export interface LangVotePart {
  done: boolean;
  lang?: string; // имя языка от Whisper ("russian"/"english"/…)
  charCount: number; // сумма длин текста РЕАЛЬНЫХ сегментов (после фильтра галлюцинаций)
  viaFallback?: boolean; // сегменты пришли только из d.text-фолбэка (не настоящая речь) → не голосует
}

// Часть даёт голос за язык только если реально произвела речь: завершена, с языком, не через
// d.text-фолбэк и с достаточным объёмом символов.
function hasRealSpeech(p: LangVotePart): boolean {
  return p.done && !!p.lang && !p.viaFallback && p.charCount >= MIN_REAL_CHARS;
}

// Язык встречи = язык с наибольшим объёмом РЕАЛЬНОЙ речи (символов) среди всех частей. Нет реальной
// речи → undefined (пина нет; каждый чанк остаётся на собственном автодетекте Whisper — сегодняшнее
// поведение). Форс-дефолта НЕТ: он исказил бы реально не-русскую встречу, а при отсутствии речи и
// пинить нечего.
export function resolveMeetingLang(parts: LangVotePart[]): string | undefined {
  const weight = new Map<string, number>();
  for (const p of parts) {
    if (!hasRealSpeech(p)) continue;
    weight.set(p.lang!, (weight.get(p.lang!) ?? 0) + p.charCount);
  }
  let best: string | undefined, bestN = 0;
  for (const [lang, n] of weight) if (n > bestN) { best = lang; bestN = n; }
  return best;
}

// Какие части надо ПЕРЕтранскрибировать: реальные (есть символы), с языком, отличным от языка
// встречи. Возвращает индексы. Пустые/незавершённые/безъязыкие/совпадающие — пропускаются.
// Мы ПЕРЕтранскрибируем с пином языка встречи, а НЕ выбрасываем часть (дропать реальный транскрипт
// владельца хуже болезни). Это и есть то, что чинит флипнутые чанки.
export function partsNeedingRetranscribe(parts: LangVotePart[], resolvedLang: string): number[] {
  const out: number[] = [];
  parts.forEach((p, i) => {
    if (!p.done || !p.lang || p.charCount === 0) return;
    if (p.lang !== resolvedLang) out.push(i);
  });
  return out;
}
