// Мелкие правила показа, общие для экранов (issue #537): сырой id вместо имени и дата.

/**
 * Сырой числовой id вместо имени? Отрицательный тоже: у вошедших через Google внутренний
 * telegram_id отрицательный («-30»), и прежняя проверка /^\d+$/ показывала его на экране голым.
 */
export function isRawId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^-?\d+$/.test(value.trim());
}

/**
 * Дата для показа или null. `new Date(битая строка)` не бросает исключение, а даёт Invalid Date,
 * и toLocaleDateString печатал на экране «Invalid Date» мимо всех try/catch.
 */
export function formatDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale = "ru-RU",
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, options);
}
