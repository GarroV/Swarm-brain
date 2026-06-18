// Классификация намерения пользователя по тексту сообщения.
// Чистые функции без внешних зависимостей — тестируются изолированно (intent_test.ts).

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/i;

/** Первый URL в тексте или null. */
export function extractUrl(text: string): string | null {
  return text.match(URL_REGEX)?.[0] ?? null;
}

// Ведущие глаголы-команды над УЖЕ существующей записью.
// «удали запись про форму», «замени эту форму на <url>» — это управление записью,
// а НЕ «сохрани ссылку». Якорь ^ + lookahead (?=\s|$), чтобы не ловить «заменитель»,
// «обновление», «удалённая» как префиксы слов.
// Метаданные (переименуй/перенеси/измени дату/исправь заголовок) сюда НЕ входят —
// их обрабатывает LLM-агент через update_entry.
const DELETE_RE = /^\s*(?:удали(?:ть)?|убери|убрать|сотри|стереть|отмени(?:ть)?)(?=\s|$)/iu;
const REPLACE_RE = /^\s*(?:замени(?:ть)?|поменя(?:й|ть)|обнови(?:ть)?|отредактируй|редактируй)(?=\s|$)/iu;

export type EntryCommand = "delete" | "replace";

/** 'delete' | 'replace' | null. null → обычный текст/вопрос/метаданные (идёт в агент). */
export function classifyEntryCommand(text: string): EntryCommand | null {
  if (DELETE_RE.test(text)) return "delete";
  if (REPLACE_RE.test(text)) return "replace";
  return null;
}

// Явное намерение «сохранить в общую базу». Детерминированно, без LLM.
// Два варианта формулировки:
//   1) <глагол> … в базу/знания/…: текст  — глагол любой (добавь/кинь/запихни/внеси…), destination фиксирован
//   2) сохрани/запомни/занеси/запиши/внеси[:] текст — ведущий глагол сохранения без destination
// «добавь» без destination сюда НЕ входит (ловил бы «добавь задачу …»).
const SAVE_DEST_RE = /^(?:\S+\s+){0,4}(?:в\s+базу|в\s+знания|в\s+хранилище|в\s+рой|в\s+сворм|в\s+swarm|в\s+улей)\s*:?\s*/i;
// (?=[\s:]|$) — чтобы не ловить «сохранил», «занесённый», «записаться» как префиксы.
const SAVE_VERB_RE = /^\s*(?:сохрани(?:те)?|запомни(?:те)?|занеси|запиши|внеси)(?=[\s:]|$)\s*:?\s*/iu;

/**
 * Если текст — явная команда сохранения, вернуть контент для сохранения
 * (без командного префикса; пустая строка, если после глагола ничего нет).
 * Иначе null — текст идёт в обычный флоу (вопрос/поиск).
 */
export function parseSaveCommand(text: string): string | null {
  const destMatch = text.match(SAVE_DEST_RE);
  if (destMatch) return text.slice(destMatch[0].length).trim();
  const verbMatch = text.match(SAVE_VERB_RE);
  if (verbMatch) return text.slice(verbMatch[0].length).trim();
  return null;
}

export interface ManageCommand {
  cmd: EntryCommand;
  query: string;
  newValue: string | undefined;
}

// Филлеры, не несущие смысла для поиска записи (включая коннектор «на»).
// \b в JS — ASCII-граница и с кириллицей не работает, поэтому фильтруем по токенам.
const FILLER = new Set([
  "эту", "этот", "это", "эти", "мою", "мой", "моё", "мои",
  "запись", "записи", "заметку", "заметка", "заметки", "ссылку", "ссылка", "строку",
  "про", "обо", "об", "о", "по", "на",
]);

/**
 * Разбирает команду управления записью на тему поиска и (для replace) новое значение.
 * newValue извлекается только если это URL — текстовую замену бот запрашивает отдельно.
 */
export function parseManageCommand(text: string): ManageCommand | null {
  const cmd = classifyEntryCommand(text);
  if (!cmd) return null;

  const verbRe = cmd === "delete" ? DELETE_RE : REPLACE_RE;
  let rest = text.replace(verbRe, " ");

  const newValue = cmd === "replace" ? (extractUrl(rest) ?? undefined) : undefined;
  if (newValue) rest = rest.replace(newValue, " ");

  const query = rest
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()))
    .join(" ")
    .trim();

  return { cmd, query, newValue };
}
