import type { LayoutItem, WidgetId } from "./homeLayout";

// Стенд-макет главной (только DEV_MODE): ?layout=A|B|C&fill=full|normal|empty подменяет раскладку и
// наполнение моков, чтобы владелец сравнивал варианты на живом коде. В проде условие ниже — константа
// false, весь модуль режется сборкой. Данные нейтральные (Demo …). Без параметров моки прежние.

export const DEV_MOCKUP = process.env.NEXT_PUBLIC_DEV_MODE === "true";

export const MOCKUP_LAYOUTS = ["A", "B", "C"] as const;
export const MOCKUP_FILLS = ["full", "normal", "empty"] as const;
export type MockupLayout = (typeof MOCKUP_LAYOUTS)[number];
export type MockupFill = (typeof MOCKUP_FILLS)[number];

const ORDERS: Record<MockupLayout, WidgetId[]> = {
  A: ["board", "ratings", "calls", "top5", "pz", "countries"],
  B: ["board", "ratings", "pz", "calls", "top5", "countries"],
  C: ["board", "ratings", "pz", "countries", "calls", "top5"],
};

/** Сколько чего в моках: встреч сегодня, задач со сроком, страны и пиццерий на страну. */
export const MOCKUP_SHAPES: Record<MockupFill, { meetings: number; tasks: number; countries: string[]; perCountry: number }> = {
  full: { meetings: 8, tasks: 5, countries: ["KZ", "PL", "BG"], perCountry: 7 },
  normal: { meetings: 3, tasks: 2, countries: ["KZ", "PL"], perCountry: 5 },
  empty: { meetings: 0, tasks: 0, countries: ["KZ"], perCountry: 4 },
};

// Адрес читается при загрузке модуля: оболочка потом сама переписывает его на «/» (pushState) и параметры
// пропали бы раньше, чем их спросят моки.
const BOOT_SEARCH = DEV_MOCKUP && typeof window !== "undefined" ? window.location.search : "";

export function mockupParams(): { layout: MockupLayout | null; fill: MockupFill | null } | null {
  if (!DEV_MOCKUP) return null;
  const q = new URLSearchParams(BOOT_SEARCH);
  const layout = MOCKUP_LAYOUTS.find((x) => x === q.get("layout")) ?? null;
  const fill = MOCKUP_FILLS.find((x) => x === q.get("fill")) ?? null;
  return layout || fill ? { layout, fill } : null;
}

/** Раскладка макета (все половинки; доска на всю строку) или null — тогда обычная. */
export function devLayout(): LayoutItem[] | null {
  const layout = mockupParams()?.layout;
  if (!layout) return null;
  return ORDERS[layout].map((id) => ({ id, w: id === "board" ? "full" : "half" }));
}

export function devShape() {
  const fill = mockupParams()?.fill;
  return fill ? MOCKUP_SHAPES[fill] : null;
}

/** Имена пиццерий мока: по параметру — страны × число на страну, без параметра — как были. */
export function shapedNames(orig: [string, string][]): [string, string][] {
  const shape = devShape();
  if (!shape) return orig;
  return shape.countries.flatMap((cc) => Array.from({ length: shape.perCountry }, (_, i) => [cc, `Demo ${cc}-${i + 1}`] as [string, string]));
}
