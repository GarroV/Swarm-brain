// Русское склонение по числу: 1 точка, 2 точки, 5 точек; 11–14 — всегда «много».
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100;
  if (h >= 11 && h <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}
