// Ручная часть страны для «Анализа рынка» — блоки эталона, вписанные руками (см. миграцию
// 20261003120000_market_editorial.sql). Здесь — только проверка при импорте: блок из списка,
// форма верхнего уровня та, что ждёт экран, нет полей прибыли и размер разумный. Разбор
// полей по одному делает экран (miniapp/src/lib/marketEditorial.ts) и пропускает кривое.

/** Блок → ожидаемая форма верхнего уровня. */
export const EDITORIAL_BLOCKS = {
  header: "object", // { eyebrow, title, lede, sources }
  kpis: "array", // до 4 × { value?, label?, note? } — поверх вычисленных плиток
  summary: "array", // [{ title, big, text }]
  texts: "object", // подзаголовки разделов: { <раздел>: "текст" }
  events: "array", // [{ date, kind, chain, text }]
  growth: "object", // { keys: [...], notes: { key: text }, hist: { key: { year: n } } }
  pizza_table: "array", // [{ name, chain, units, entry, rev: { период: € }, per: {…}, lfl, note }]
  dodo_monthly: "array", // [{ m, usd, fx, eur, units, per }]
  dodo_ops: "array", // [{ m, u, rev, agg, din, own, o, oagg, odin, oown }]
  basket: "array", // [{ col, one, two, promo }]
  ops_model: "object", // { chains: [...], rows: [[подпись, ...значения]] }
  ratings: "array", // [{ chain, point, city, google, reviews, wolt }]
  delivery_platforms: "array", // [{ name, slot, note, years: [{ year, revenue_eur }] }]
  delivery_figures: "array", // [{ big, text }]
  market_facts: "array", // [{ big, text, source }]
  money_rows: "array", // [{ prefix, chains: [...] | null }]
  map_presets: "array", // [{ name, box: [lng0, lat0, lng1, lat1] }]
  prices_cols: "array", // [{ title, chain, channel?, cm?, exclude? }]
} as const;
export type EditorialBlock = keyof typeof EDITORIAL_BLOCKS;
export type Editorial = Partial<Record<EditorialBlock, unknown>>;

const MAX_BLOCK_BYTES = 300_000;
// Правило эталона: прибыли и убытка нет нигде — даже в ручном блоке, который экран не показывает.
const PROFIT_KEY = /profit|loss|dobit|gubit/i;

function profitKeys(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => profitKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (PROFIT_KEY.test(k)) out.push(`${path}.${k}`);
      profitKeys(x, `${path}.${k}`, out);
    }
  }
}

export function parseEditorial(raw: unknown, errors: string[]): Editorial {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("editorial: нужен объект { блок: содержимое }");
    return {};
  }
  const out: Editorial = {};
  for (const [block, payload] of Object.entries(raw as Record<string, unknown>)) {
    const shape = EDITORIAL_BLOCKS[block as EditorialBlock];
    if (!shape) {
      errors.push(`editorial.${block}: неизвестный блок`);
      continue;
    }
    const isArray = Array.isArray(payload);
    if ((shape === "array") !== isArray || (!isArray && (payload === null || typeof payload !== "object"))) {
      errors.push(`editorial.${block}: ожидается ${shape === "array" ? "массив" : "объект"}`);
      continue;
    }
    if (JSON.stringify(payload).length > MAX_BLOCK_BYTES) {
      errors.push(`editorial.${block}: больше ${MAX_BLOCK_BYTES} байт`);
      continue;
    }
    const bad: string[] = [];
    profitKeys(payload, `editorial.${block}`, bad);
    if (bad.length) {
      errors.push(`${bad[0]}: прибыль и убыток в разделе не показываются`);
      continue;
    }
    out[block as EditorialBlock] = payload;
  }
  return out;
}
