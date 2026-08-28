// Разбор задач, предложенных GPT из тезисов встречи (`POST /tasks/extract`, save:false).
//
// Зачем отдельный модуль: ответ модели нельзя брать как есть. Промпт просит «... или null»,
// и модель регулярно пишет СТРОКУ "null" — на карточке разбора это висело серым чипом «null»
// вместо страны (issue #125). Промпт починен, но модель недетерминирована: проверку она
// проигнорировать не может, а промпт — запросто. Поэтому нормализация стоит вторым слоем,
// ровно как у `due_date` на сервере.
//
// Второй кусок — резолв исполнителя (issue #126): GPT отдаёт ИМЯ, а задаче нужен telegram_id.
// Совпадения нет — «Не назначен»; исполнителя не выдумываем, повесить задачу не на того хуже,
// чем не повесить ни на кого.
//
// Типы объявлены локально и без импортов, чтобы файл гонялся `deno test` вместе с остальными
// тестами веба (алиас `@/` deno не разрешает). Совместимость с CreateTaskInput / User
// проверяет `tsc --noEmit` в точках вызова.

export type ProposedTask = {
  title: string;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  country: string | null;
};

/** Подмножество User, достаточное для резолва. */
export type AssigneeCandidate = {
  telegram_id: number;
  name: string;
  username?: string | null;
};

// Значения, которые модель выдаёт вместо пустоты. Всё это — «ничего», а не текст.
const BLANKS = new Set(["", "null", "none", "nil", "undefined", "n/a", "na", "-", "—", "–", "не указано", "нет"]);

/** Сравнимая форма строки: без краевых пробелов, одинарные пробелы, нижний регистр, ё→е. */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");
}

/** Строка из непредсказуемого JSON: не-строка и любая «пустышка» → null. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return BLANKS.has(norm(trimmed)) ? null : trimmed;
}

/**
 * Одна предложенная задача в пригодном для показа виде.
 * Описание, дублирующее заголовок, выбрасывается: в разборе от него ноль пользы,
 * оно только удлиняет карточку и мешает вычитывать остальные.
 */
export function normalizeProposedTask(raw: unknown): ProposedTask {
  const src = (raw ?? {}) as Record<string, unknown>;
  const title = text(src.title) ?? "";
  const description = text(src.description);
  return {
    title,
    description: description && norm(description) === norm(title) ? null : description,
    assignee: text(src.assignee),
    due_date: text(src.due_date),
    country: text(src.country),
  };
}

/** Список предложений: мусор на входе → пустой разбор, задачи без заголовка отсеиваются. */
export function normalizeProposedTasks(raw: unknown): ProposedTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeProposedTask).filter((t) => t.title.length > 0);
}

/** Единственный кандидат из списка — или null, если их ноль либо больше одного. */
function onlyOne(matches: AssigneeCandidate[]): number | null {
  return matches.length === 1 ? matches[0].telegram_id : null;
}

/**
 * Имя от GPT → telegram_id из списка пользователей воркспейса.
 * Три попытки по убыванию надёжности: полное имя → username → единственное совпадение по
 * любому слову имени («Мария» → «Мария Иванова»). Неоднозначность («Пётр» при двух Петрах)
 * трактуется как промах: лучше «Не назначен», чем задача не на том человеке.
 */
export function resolveAssigneeId(
  assignee: string | null | undefined,
  users: readonly AssigneeCandidate[],
): number | null {
  const needle = text(assignee);
  if (!needle) return null;
  const n = norm(needle);

  const byFullName = users.filter((u) => norm(u.name ?? "") === n);
  if (byFullName.length > 0) return onlyOne(byFullName);

  const handle = n.replace(/^@/, "");
  const byUsername = users.filter((u) => u.username && norm(u.username) === handle);
  if (byUsername.length > 0) return onlyOne(byUsername);

  // Только для однословного ввода: «Мария» однозначна, «Мария Иванова» уже проверена выше,
  // а разбивать многословный ввод на слова — путь к ложным совпадениям по фамилии-омониму.
  if (n.includes(" ")) return null;
  const byToken = users.filter((u) => norm(u.name ?? "").split(" ").includes(n));
  return onlyOne(byToken);
}

/**
 * Кому РЕАЛЬНО уйдёт задача при публикации из разбора: имя от GPT → id, а если ответственного
 * не назвали вовсе — публикующему.
 *
 * Прод-инцидент 28.08.2026: коллега разобрала встречу и нажала «Добавить». Модель не назвала
 * ответственных, задачи легли без исполнителя и без срока — то есть мимо «Сегодня» (список
 * требует срок) и мимо секции с её именем в группировке по сотрудникам. Тост сказал
 * «Добавлено 2 задачи», человек их нигде не нашёл и решил, что ничего не сохранилось.
 *
 * Отсюда правило: молчание модели значит «это задача того, кто её сейчас забирает», а не
 * «ничья». А вот НАЗВАННОЕ, но чужое или неоднозначное имя по-прежнему даёт null — подменять
 * его собой значило бы тихо переписать ответственного (строка разбора честно пишет «не найден»).
 */
export function effectiveAssigneeId(
  assignee: string | null | undefined,
  users: readonly AssigneeCandidate[],
  meId: number | null,
): number | null {
  if (!text(assignee)) return meId;
  return resolveAssigneeId(assignee, users);
}

/**
 * «Добавить 1 задачу / 2 задачи / 5 задач» — русская форма числительного.
 * Вынесено сюда, потому что кнопка разбора — главная в окне, и «Добавить 1 задач»
 * на ней выглядит как сломанный продукт.
 */
export function taskCountLabel(n: number): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} задач`;
  if (mod10 === 1) return `${n} задачу`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} задачи`;
  return `${n} задач`;
}
