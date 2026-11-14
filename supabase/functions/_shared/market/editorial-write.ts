// Проверка потери данных по настоящему разборщику экрана. Правила чтения не дублируются:
// сравниваем присланное с тем, что экран сохранит после разбора, до любой записи в БД.
import { type Editorial, EVENT_KINDS, parseEditorial } from "./editorial-view.ts";

const ROW_HINTS: Record<string, string> = {
  summary: "нужны непустые title и big",
  events: `нужны date (ГГГГ[-ММ[-ДД]]), kind (${EVENT_KINDS.join(", ")}) и text`,
  pizza_table: "нужны непустые name и chain",
  dodo_monthly: "нужны m (ГГГГ-ММ) и eur числом",
  dodo_ops: "нужны u, m от 1 до 12 и o больше нуля",
  basket: "нужны col и one числом",
  ratings: "нужны chain, point и хотя бы одна числовая оценка google/wolt/glovo/bolt/yandex_eda",
  delivery_platforms: "нужно непустое name",
  delivery_figures: "нужны непустые big и text",
  market_facts: "нужны непустые big и text",
  money_rows: "нужен непустой prefix",
  location_dates: "нужны name и хотя бы одна дата: opened или closed (ГГГГ[-ММ[-ДД]])",
  map_presets: "нужны name и box из четырёх чисел",
  prices_cols: "нужны непустые title и chain",
};

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const errorAt = (path: string) => `${path}: значение не будет показано — проверь тип и формат поля по market_template`;

function lostValue(raw: unknown, shown: unknown, path: string): string | null {
  // Отсутствующие необязательные значения и пустые контейнеры разрешают очистить блок.
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  if (Array.isArray(raw)) {
    if (!Array.isArray(shown) || raw.length !== shown.length) return `${path}: часть значений не будет показана`;
    for (let i = 0; i < raw.length; i++) {
      const issue = lostValue(raw[i], shown[i], `${path}[${i}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (object(raw)) {
    if (!Object.keys(raw).length) return null;
    if (!object(shown)) return errorAt(path);
    for (const [field, value] of Object.entries(raw)) {
      // Эти старые имена разборщик намеренно принимает как альтернативные названия.
      const aliases: Record<string, string> = /^editorial\.ratings\[\d+\]$/.test(path)
        ? { glovo_pct: "glovo", bolt_food: "bolt", yandex_eda: "yandex" }
        : {};
      const issue = lostValue(value, shown[aliases[field] ?? field], `${path}.${field}`);
      if (issue) return issue;
    }
    return null;
  }
  if (shown instanceof RegExp && typeof raw === "string") return null;
  // Число → текст разрешено самим экраном (units, value плитки, ячейки ops_model).
  if (raw === shown || (typeof raw === "number" && typeof shown === "string" && String(raw) === shown)) return null;
  return errorAt(path);
}

export function editorialViewIssue(block: string, payload: unknown): string | null {
  const key =
    (block === "delivery_platforms"
      ? "platforms"
      : block.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())) as keyof Editorial;
  const shown = parseEditorial({ [block]: payload })[key];
  const path = `editorial.${block}`;
  if (!Array.isArray(payload)) return lostValue(payload, shown, path);
  if (!Array.isArray(shown)) return errorAt(path);
  if (payload.length > shown.length) {
    // Находим первую потерянную строку, а не просто говорим «блок пустой».
    for (let i = 0; i < payload.length; i++) {
      const row = parseEditorial({ [block]: [payload[i]] })[key];
      if (!Array.isArray(row) || !row.length) {
        return `${path}[${i}]: строка не будет показана — ${ROW_HINTS[block] ?? "нужен объект с полями блока"}`;
      }
    }
    return `${path}: не все строки будут показаны (введено ${payload.length}, показано ${shown.length})`;
  }
  // Разбираем по одной: экран может сортировать строки, это не потеря информации.
  for (let i = 0; i < payload.length; i++) {
    const row = parseEditorial({ [block]: [payload[i]] })[key] as unknown[];
    const issue = lostValue(payload[i], row[0], `${path}[${i}]`);
    if (issue) return issue;
  }
  return null;
}
