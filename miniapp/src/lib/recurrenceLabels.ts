// Подписи цикличности задачи. День недели и число месяца не хранятся отдельно — они и есть
// срок задачи (см. _shared/tasks/recurrence.ts), поэтому «По средам» и «26-го числа» —
// производные от `due_date`, а не отдельные настройки. Исключение: у monthly приоритет за
// `recur_anchor_dom`, если он есть — у задачи, зажатой коротким месяцем (срок 28.02, якорь 31),
// срок показывает не то число, по которому она реально ходит.
//
// Русский день недели берётся в ДАТЕЛЬНОМ падеже множественного числа («по средам»): вариант
// «каждый <день>» ломается на роде — «каждый среда»/«каждый суббота». Английский — таблицей и
// собственными порядковыми числами, чтобы не зависеть от ICU-данных окружения.
//
// Типы локальные, без импортов: файл гоняется `deno test` вместе с остальными тестами веба.

export type RecurFreqName = "daily" | "weekly" | "monthly";

export type RecurrenceOption = { freq: RecurFreqName; ru: string; en: string };
export type RecurrenceText = { ru: string; en: string };

// Дательный падеж множественного числа: «по <…>».
const RU_WEEKDAY_DATIVE = [
  "воскресеньям", "понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам",
];
const EN_WEEKDAY = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** Индекс дня недели (0 = воскресенье) по календарной дате, без влияния часового пояса. */
function weekdayIndex(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

function dayOfMonth(iso: string): number | null {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso);
  return m ? Number(m[1]) : null;
}

/** 1st / 2nd / 3rd / 4th, с исключением для 11–13 («eleventh», не «eleven-first»). */
export function ordinalEn(n: number): string {
  const inTeens = n % 100 >= 11 && n % 100 <= 13;
  const suffix = inTeens ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Три варианта цикличности с подписями от срока. null — срока нет: цикличность включить нельзя
 * (форма показывает подсказку «сначала поставь срок»).
 */
export function recurrenceOptions(
  dueISO: string | null | undefined,
  anchorDom?: number | null,
): RecurrenceOption[] | null {
  if (!dueISO) return null;
  const wd = weekdayIndex(dueISO);
  // Якорь важнее числа из срока: у зажатой задачи (срок 28.02, якорь 31) срок показывает 28,
  // а ходит она по 31-м — подпись «28-го числа» была бы неправдой.
  const dom = anchorDom ?? dayOfMonth(dueISO);
  if (wd == null || dom == null) return null;

  return [
    { freq: "daily", ru: "Каждый день", en: "Every day" },
    { freq: "weekly", ru: `По ${RU_WEEKDAY_DATIVE[wd]}`, en: `Every ${EN_WEEKDAY[wd]}` },
    { freq: "monthly", ru: `${dom}-го числа каждый месяц`, en: `Monthly on the ${ordinalEn(dom)}` },
  ];
}

/** Короткая подпись для бейджа в строке задачи, где срок может быть не виден. */
export function recurrenceBadge(
  freq: string | null | undefined,
  dueISO: string | null | undefined,
  anchorDom?: number | null,
): RecurrenceText | null {
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") return null;
  if (freq === "daily") return { ru: "каждый день", en: "daily" };

  const wd = dueISO ? weekdayIndex(dueISO) : null;
  const dom = anchorDom ?? (dueISO ? dayOfMonth(dueISO) : null);
  // Срок могли снять мимо веба (правка в базе/через MCP) — честнее показать «повторяется»,
  // чем уронить строку или соврать конкретным днём.
  if (wd == null || dom == null) return { ru: "повторяется", en: "repeats" };

  return freq === "weekly"
    ? { ru: `по ${RU_WEEKDAY_DATIVE[wd]}`, en: "weekly" }
    : { ru: `${dom}-го числа`, en: "monthly" };
}
