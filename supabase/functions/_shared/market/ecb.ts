// Ряд курсов ЕЦБ (SDMX-JSON data-api.ecb.europa.eu). Общий для сборщика (scripts/market) и главной (mtd.ts).

export type EcbJson = {
  dataSets: Array<
    {
      series: Record<
        string,
        { observations: Record<string, [number | null, ...unknown[]]> }
      >;
    }
  >;
  structure: {
    dimensions: { observation: Array<{ values: Array<{ id: string }> }> };
  };
};
/** Ряд курсов ЕЦБ: период («2025», «2026-09» или «2026-11-05») → единиц валюты за 1 €. */
export function parseEcbSeries(j: EcbJson): Record<string, number> {
  const periods = j.structure.dimensions.observation[0]?.values ?? [];
  const series = Object.values(j.dataSets[0]?.series ?? {})[0];
  if (!series) return {};
  return Object.fromEntries(
    Object.entries(series.observations).flatMap(([i, [v]]) =>
      typeof v === "number" && periods[Number(i)] ? [[periods[Number(i)].id, v]] : []
    ),
  );
}
