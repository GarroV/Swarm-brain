// Демо-витрина обязана быть английской (docs/decisions/2026-09-23-english-only-for-demo.md),
// а отказы swarm-api исторически по-русски (issue #605). Переводим на выходе ответа ДЕМО-сессии:
// `error` становится английским, русский уезжает в `error_ru`. Рабочие сессии не трогаются —
// у команды интерфейс русский. Неизвестный русский текст в демо получает общий английский,
// а не остаётся русским: витрина важнее точности формулировки.

const EN: Record<string, string> = {
  "Задача не найдена": "Task not found",
  "Метка не найдена": "Label not found",
  "Комментарий не найден": "Comment not found",
  "Файл не найден": "File not found",
  "Приглашение не найдено": "Invite not found",
  "Пространство не найдено": "Space not found",
  "Текст обязателен": "Text is required",
  "Пустой комментарий": "Comment is empty",
  "Пустая пометка": "Note is empty",
  "Нечего менять": "Nothing to change",
  "Неизвестная метка": "Unknown label",
  "Название метки обязательно": "Label name is required",
  "Метки доступны только на личных задачах": "Labels are available on personal tasks only",
  "Спринт принят, состав не меняется": "The sprint is accepted; its scope no longer changes",
  "Уже опубликовано — правьте запись в базе": "Already published — edit the entry in the knowledge base",
  "Уже в базе — удаляйте через раздел «База»": "Already in the knowledge base — delete it there",
  "У записи нет транскрипта встречи — спросить не по чему": "This entry has no meeting transcript to ask about",
  "Не удалось получить ответ — попробуй ещё раз": "Could not get an answer — try again",
  "Убрать файл может тот, кто его прикрепил, или владелец задачи":
    "Only the uploader or the task owner can remove this file",
  "Файл загрузился не целиком — попробуйте ещё раз": "The file did not upload completely — try again",
  "Хранилище файлов не настроено": "File storage is not configured",
  "Хранилище файлов сейчас недоступно": "File storage is unavailable right now",
  "Не удалось загрузить файлы": "Could not load files",
  "Не удалось сохранить файл": "Could not save the file",
  "Не удалось завести файл": "Could not create the file",
  "Не удалось убрать файл": "Could not remove the file",
  "Не удалось удалить комментарий": "Could not delete the comment",
  "Не удалось загрузить уведомления": "Could not load notifications",
  "Не удалось отметить прочитанным": "Could not mark as read",
  "Не удалось сохранить подписку": "Could not save the subscription",
  "Не удалось": "Something went wrong",
  "цикличность требует срока (due_date)": "A recurring task needs a due date",
  "recur_weekdays: дни недели задаются только для weekly": "recur_weekdays: weekdays apply to weekly only",
  "recur_setpos: n-й день недели задаётся только для monthly": "recur_setpos: the nth weekday applies to monthly only",
  "правило повтора без частоты: сначала задай recur_freq": "A repeat rule needs a frequency: set recur_freq first",
  "нельзя вкладывать глубже 2 уровней": "Projects can't be nested more than 2 levels deep",
  "проект не может быть родителем самому себе": "A project can't be its own parent",
  "у проекта есть подпроекты — его нельзя делать подпроектом": "This project has subprojects and can't become one",
  "родитель не найден в воркспейсе": "Parent not found in this workspace",
  "Нечего сохранять: ожидается email": "Nothing to save: an email is expected",
  "Задачу одновременно изменил кто-то ещё — обнови и попробуй снова":
    "Someone else changed this task at the same time — refresh and try again",
};

/** Шаблонные отказы «<поле> не найден в этом воркспейсе» и «<поле>: ожидается …». */
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(\w+) не найден в этом воркспейсе$/, (m) => `${m[1]} not found in this workspace`],
  [/^(\w+) обязателен(?: .*)?$/, (m) => `${m[1]} is required`],
  [/^(\w+) и (\w+) обязательны$/, (m) => `${m[1]} and ${m[2]} are required`],
  [/^(\w+): ожидается .+$/, (m) => `${m[1]}: invalid value`],
  [/^(\w+) требует (\w+)$/, (m) => `${m[1]} requires ${m[2]}`],
  [/^(\w+) не может быть позже (\w+)$/, (m) => `${m[1]} can't be later than ${m[2]}`],
  [
    /^Not found или спринт уже (начат|принят)$/,
    (m) => `Not found, or the sprint is already ${m[1] === "начат" ? "started" : "accepted"}`,
  ],
];

const CYRILLIC = /[А-Яа-яЁё]/;
export const DEMO_FALLBACK_ERROR = "The request could not be completed";

/** Английский текст для русского отказа; не русский — как есть. */
export function englishError(ru: string): string {
  if (!CYRILLIC.test(ru)) return ru;
  if (EN[ru]) return EN[ru];
  for (const [re, fmt] of PATTERNS) {
    const m = ru.match(re);
    if (m) return fmt(m);
  }
  return DEMO_FALLBACK_ERROR;
}

/** Тело ответа: перевести `error`, русский положить в `error_ru` (если его там ещё нет). */
export function englishErrorBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  if (typeof b.error !== "string" || !CYRILLIC.test(b.error)) return body;
  return { ...b, error: englishError(b.error), error_ru: b.error_ru ?? b.error };
}

/** Ответ демо-сессии: переводим только JSON-отказы, остальное отдаём нетронутым. */
export async function englishDemoResponse(res: Response): Promise<Response> {
  if (res.status < 400 || !(res.headers.get("Content-Type") ?? "").includes("application/json")) return res;
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: res.status, headers: res.headers });
  }
  return new Response(JSON.stringify(englishErrorBody(body)), { status: res.status, headers: res.headers });
}

/** Какие запросы пришли от демо-сессии: помечает роутер после разбора личности. */
export const DEMO_REQUESTS = new WeakSet<Request>();
