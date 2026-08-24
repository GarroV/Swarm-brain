// Нормализация срока (due_date), пришедшего от языковой модели.
//
// Зачем: во всех промптах извлечения задач модель не знает сегодняшней даты. Когда в тексте
// встречи назван день без года («заполнить таблицу до 17 августа»), модель дописывает год
// сама — и берёт его из своих обучающих данных. На проде это стабильно давало 2023-й
// (задача 6d2f64e5 от 2026-08-24 приехала со сроком 2023-08-28 — год чужой, день из встречи).
//
// Защита в два слоя: промпт получает сегодняшнюю дату (слой 1), а результат модели проходит
// через эту функцию (слой 2) — промпт можно проигнорировать, проверку нельзя.
//
// Применяется ТОЛЬКО на границе «модель → база». Дату, которую человек выбрал в календаре,
// не трогаем: там прошедший срок — осознанный выбор, а не галлюцинация.
//
// Два вида дат живут в разных окнах, поэтому и функции две:
//   • срок задачи (due_date) смотрит в будущее — прошлое допустимо чуть-чуть;
//   • дата события записи (entry_date) смотрит в прошлое — будущее почти всегда ошибка.

// Окно вменяемости для СРОКА задачи. Назад — 60 дней: встречу вычитывают не в день записи,
// и «до 17 августа» на разборе 24-го — нормальная просроченная задача, а не ошибка года.
// Вперёд — 540 дней: дальше горизонта планирования команды.
const DUE_PAST_DAYS = 60;
const DUE_FUTURE_DAYS = 540;

// Окно вменяемости для ДАТЫ СОБЫТИЯ записи. Назад — год (грузят и старые документы),
// вперёд — неделя: встреча, назначенная дальше, в базу знаний ещё не попадает.
const EVENT_PAST_DAYS = 400;
const EVENT_FUTURE_DAYS = 7;

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Сегодняшняя дата в UTC как YYYY-MM-DD — референс для промптов и нормализации. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** UTC-полночь для валидной ISO-даты; null, если строка не дата или дня нет в календаре. */
function parseIso(value: string): Date | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Отсев несуществующих дат: 2026-02-30 → 2 марта, значит компоненты не совпадут.
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

type Window = { pastDays: number; futureDays: number };

function isSane(candidate: Date, today: Date, w: Window): boolean {
  const delta = diffDays(candidate, today);
  return delta >= -w.pastDays && delta <= w.futureDays;
}

/**
 * Общий приём: год от модели — ненадёжен, день и месяц — как правило верны.
 *
 * - не ISO / несуществующая дата → null (мусор в базу не кладём);
 * - дата в окне вокруг сегодня → как есть;
 * - иначе год считается галлюцинацией: день и месяц сохраняем, год берём ближайший,
 *   при котором дата попадает в окно;
 * - если подходящего года нет → null (лучше без даты, чем с выдуманной).
 */
function normalizeInWindow(raw: string | null | undefined, today: string, w: Window): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value || value.toLowerCase() === "null") return null;

  const parsed = parseIso(value);
  if (!parsed) return null;

  const ref = parseIso(today);
  if (!ref) return value; // без референса не гадаем — отдаём как есть

  if (isSane(parsed, ref, w)) return value;

  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const refYear = ref.getUTCFullYear();

  let best: Date | null = null;
  for (let year = refYear - 2; year <= refYear + 2; year++) {
    const candidate = parseIso(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    if (!candidate || !isSane(candidate, ref, w)) continue; // 29 февраля в невисокосный год отсеется здесь
    if (!best || Math.abs(diffDays(candidate, ref)) < Math.abs(diffDays(best, ref))) best = candidate;
  }

  return best ? toIso(best) : null;
}

/** Срок задачи из ответа модели: «до 17 августа» без года → ближайший подходящий год. */
export function normalizeExtractedDueDate(raw: string | null | undefined, today: string = todayIso()): string | null {
  return normalizeInWindow(raw, today, { pastDays: DUE_PAST_DAYS, futureDays: DUE_FUTURE_DAYS });
}

/** Дата события записи (встреча, документ) из ответа модели: смотрит в прошлое, не в будущее. */
export function normalizeExtractedEventDate(raw: string | null | undefined, today: string = todayIso()): string | null {
  return normalizeInWindow(raw, today, { pastDays: EVENT_PAST_DAYS, futureDays: EVENT_FUTURE_DAYS });
}
