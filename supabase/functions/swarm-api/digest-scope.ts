// Охват персонального дайджеста: по своим рынкам, по всему воркспейсу (админский чекбокс)
// или «рынки не выбраны».
//
// Отдельным модулем — потому что до issue #154 решение жило одним условием прямо в запросе:
//   if (!allCountries && countryVariants.length) q = q.overlaps("countries", countryVariants)
// Пустой markets делал условие ложным, фильтр стран МОЛЧА не применялся, и человек получал
// сводку по всему воркспейсу — в ней доминируют самые многочисленные рынки, поэтому выглядело
// это как «мне показывают чужой дайджест». Ошибка была не в фильтре, а в том, что у «нет
// рынков» не было своего исхода: оно молча схлопывалось в «показать всё».
export type DigestScope = "workspace" | "markets" | "needs-markets";

export function resolveDigestScope(markets: readonly string[], allCountries: boolean): DigestScope {
  // Админский «весь воркспейс» осознанно снимает фильтр — рынки для него не нужны.
  if (allCountries) return "workspace";
  return markets.length > 0 ? "markets" : "needs-markets";
}
