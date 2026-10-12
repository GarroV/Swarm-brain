// «Страна настроена» для переключателя «Анализа рынка» (issue #904): данные у неё обновляются сами.
// Правило — то же «плохо», что у экрана свежести (`freshness` в miniapp/src/lib/marketView.ts,
// `STALE_DAYS` там же): авто-источник упал последним прогоном, молчит дольше STALE_DAYS или ни
// разу не был ок. Готова страна, у которой есть хотя бы один авто-источник и ни одного плохого.
// Меняешь порог или условие «плохо» — меняй в обоих местах; тесты каждого стоят рядом.

export const STALE_DAYS = 8;
const DAY_MS = 86_400_000;

export type ReadinessSource = { adapter: string; mode: string; last_ok_at: string | null };
export type ReadinessRun = { source: string; status: string; finished_at: string };

export function isCountryReady(sources: ReadinessSource[], runs: ReadinessRun[], now: Date): boolean {
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
  now: Date,
): string[] {
  return countries.filter((c) =>
    isCountryReady(sources.filter((s) => s.country === c), runs.filter((r) => r.country === c), now)
  );
}
