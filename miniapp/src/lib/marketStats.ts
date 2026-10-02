// Производные «Анализа рынка»: считаются на экране из реестра точек, в базе не хранятся —
// динамика сетей и таймлайн берутся из дат открытия и закрытия.
export type StatLoc = { chain: string; opened: string | null; status: string; closed: string | null };

const yearOf = (s: string | null): number | null => (s && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null);

/** Точек на конец года, как aliveAt эталона. Без даты открытия — считается открытой до начала
 *  графика; анонс не считается вовсе; закрытая без даты закрытия не считается ни в одном году —
 *  кроме точки из API Dodo (source_kind dodo): про неё известно, что она работала, и в прошлых
 *  годах она есть. */
export function aliveAtYearEnd(
  locs: Array<Omit<StatLoc, "chain"> & { source_kind?: string }>,
  year: number,
  thisYear = new Date().getFullYear(),
): number {
  return locs.filter((l) => {
    if (l.status === "planned") return false;
    const o = yearOf(l.opened);
    if (o !== null && o > year) return false;
    if (l.status !== "closed") return true;
    const c = yearOf(l.closed);
    if (c !== null) return c > year;
    // Закрыта без даты: так отдаёт API Dodo — в прошлых годах была, сейчас её нет.
    return l.source_kind === "dodo" && thisYear > year;
  }).length;
}

export function unitsByYear(locs: StatLoc[], chains: string[], years: number[]): Record<string, number[]> {
  return Object.fromEntries(chains.map((c) => {
    const own = locs.filter((l) => l.chain === c);
    return [c, years.map((y) => aliveAtYearEnd(own, y))];
  }));
}
