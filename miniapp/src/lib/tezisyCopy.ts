// Текст, который уезжает в буфер по кнопке «Копировать» над тезисами встречи.
//
// Решение владельца 03.09.2026: на экране пометки об AI быть не должно — она нужна именно
// в СКОПИРОВАННОМ тексте, чтобы вставленный куда-то конспект сам объяснял, что его собрала
// модель и из какой он встречи. Поэтому шапка формируется на копировании, а НЕ вшивается
// в draft_notes_md: в тексте она уехала бы в поиск и эмбеддинги, дублировалась бы при каждой
// регенерации тезисов и пропадала бы при ручной правке (отредактированные тезисы мы не
// перезаписываем).
//
// Логика вынесена из компонента в lib, чтобы её держал тест: формат копии — то, что реально
// уходит людям во внешние переписки, и молчаливо испортить его нельзя.

export type TezisyCopyMeta = {
  title?: string | null;
  /** ISO-дата встречи. Кривую/пустую молча пропускаем — шапка просто будет короче. */
  date?: string | null;
};

export type TezisyCopyLabels = {
  /** «Обработано с помощью AI» / «Processed with AI» */
  notice: string;
  /** «Встреча» / «Meeting» */
  meeting: string;
  /** Локаль для даты: «ru-RU» / «en-US» */
  locale: string;
};

/** Дата в шапке — полная («3 сентября 2026»), а не короткая как в списках: скопированный текст
 *  читают вне продукта, где «3 сент.» без года уже ни к чему не привязывает. */
export function longDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    // Русский Intl отдаёт «3 сентября 2026 г.» — канцелярское «г.» в шапке копии лишнее,
    // срезаем. Для остальных локалей правило безвредно: там такого хвоста нет.
    return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
      .replace(/\s*\u0433\.$/, "");
  } catch {
    return null;
  }
}

export function buildTezisyCopyText(text: string, meta: TezisyCopyMeta, l: TezisyCopyLabels): string {
  const head = [l.notice];
  const parts = [meta.title?.trim(), longDate(meta.date, l.locale)].filter(Boolean);
  if (parts.length > 0) head.push(`${l.meeting}: ${parts.join(" · ")}`);
  const body = text.trim();
  return body ? `${head.join("\n")}\n\n${body}` : head.join("\n");
}
