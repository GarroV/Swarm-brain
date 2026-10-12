// «Страница проработана» для переключателя «Анализа рынка» (issue #904): у страны заполнены все
// разделы и данные обновляются сами. Условия — ВСЕ сразу: (1) есть авто-источник и ни один не
// «плохой» (то же правило, что `freshness` в miniapp/src/lib/marketView.ts, `STALE_DAYS` там же:
// упал последним прогоном, молчит дольше STALE_DAYS или ни разу не был ок); (2) есть ручная часть
// отчёта (mkt_editorial); (3) есть цены; (4) есть факты рынка; (5) есть финансы компаний.
// Одного условия (1) мало: по проду ему удовлетворяют все страны (у каждой свежий dodo-publicapi),
// а владелец просил выделить только по-настоящему проработанные (сейчас — Хорватия).
// Меняешь порог или условие «плохо» — меняй в обоих местах; тесты каждого стоят рядом.

export const STALE_DAYS = 8;
const DAY_MS = 86_400_000;

export type ReadinessSource = { adapter: string; mode: string; last_ok_at: string | null };
export type ReadinessRun = { source: string; status: string; finished_at: string };

/** Какие разделы страны не пусты. */
export type FilledSections = { editorial: boolean; prices: boolean; facts: boolean; financials: boolean };

export function isCountryReady(
  sources: ReadinessSource[],
  runs: ReadinessRun[],
  filled: FilledSections,
  now: Date,
): boolean {
  if (!filled.editorial || !filled.prices || !filled.facts || !filled.financials) return false;
  const auto = sources.filter((s) => s.mode === "auto");
  if (!auto.length) return false;
  return auto.every((s) => {
    const last = runs.filter((r) =>
      r.source === s.adapter
    ).sort((a, b) => b.finished_at.localeCompare(a.finished_at))[0];
    if (last?.status === "failed") return false;
    if (!s.last_ok_at) return false;
    return Math.floor((now.getTime() - Date.parse(s.last_ok_at)) / DAY_MS) <= STALE_DAYS;
  });
}

/** Коды готовых стран среди `countries`; источники и запуски — строками всех стран разом. */
export function readyCountries(
  countries: string[],
  sources: Array<ReadinessSource & { country: string }>,
  runs: Array<ReadinessRun & { country: string }>,
  filled: Record<string, FilledSections>,
  now: Date,
): string[] {
  const none: FilledSections = { editorial: false, prices: false, facts: false, financials: false };
  return countries.filter((c) =>
    isCountryReady(sources.filter((s) => s.country === c), runs.filter((r) => r.country === c), filled[c] ?? none, now)
  );
}
