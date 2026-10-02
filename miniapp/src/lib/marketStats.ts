// Производные «Анализа рынка»: считаются на экране из реестра точек, в базе не хранятся —
// динамика сетей и таймлайн берутся из дат открытия и закрытия.
export type StatLoc = { chain: string; opened: string | null; status: string; closed: string | null };

const yearOf = (s: string | null): number | null => (s && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null);

/** Точек на конец года. Без даты открытия — считается открытой до начала графика;
 *  анонс не считается вовсе. */
export function aliveAtYearEnd(locs: Array<Omit<StatLoc, "chain">>, year: number): number {
  return locs.filter((l) => {
    if (l.status === "planned") return false;
    const o = yearOf(l.opened);
    if (o !== null && o > year) return false;
    const c = yearOf(l.closed);
    return !(l.status === "closed" && c !== null && c <= year);
  }).length;
}

export function unitsByYear(locs: StatLoc[], chains: string[], years: number[]): Record<string, number[]> {
  return Object.fromEntries(chains.map((c) => {
    const own = locs.filter((l) => l.chain === c);
    return [c, years.map((y) => aliveAtYearEnd(own, y))];
  }));
}
