import type { CountryConfig } from "./types.ts";

// Кыргызстан. Разведка 03.11.2026: Overture даёт всего 41 точку (KFC 7, Империя Пиццы 21), в OSM
// 2198 заведений с именем — сети и их точки там полнее (KFC 14, Империя пиццы 20, Wok Lagman 7).
// Поэтому карта — OSM (overpass), а не Overture; у локальных сетей тега brand нет — ищем по
// началу name (кириллица и латиница). Общие названия («Столовая», «Ашкана», «Чайхана») сетью не считаем.
// Отчётность юрлиц не собираем (companies пусто).
export const KG: CountryConfig = {
  country: "KG",
  dodoCode: "kg",
  currency: "KGS",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "kfc",
      name: "KFC",
      segment: "chicken",
      osmBrands: ["KFC"],
    },
    {
      key: "papajohns",
      name: "Papa John's",
      segment: "pizza",
      osmBrands: ["Papa John's", "Papa Johns"],
    },
    {
      key: "imperiya-pizzy",
      name: "Империя Пиццы",
      segment: "pizza",
      osmBrands: ["Империя Пиццы"],
      osmNames: ["Империя пиццы", "Imperia Pizza"],
    },
    {
      key: "wok-lagman",
      name: "Wok Lagman",
      segment: "asian",
      osmNames: ["Wok Lagman"],
    },
    {
      key: "begemot",
      name: "Бегемот",
      segment: "other",
      osmNames: ["Бегемот", "Begemot"],
    },
    {
      key: "mubarak",
      name: "Mubarak",
      segment: "other",
      osmNames: ["Mubarak"],
    },
    {
      key: "navat",
      name: "Navat",
      segment: "other",
      osmNames: ["Нават", "Navat", "Чайхана Нават", "Чайхана Navat"],
    },
    {
      key: "coffee-like",
      name: "Coffee Like",
      segment: "coffee",
      osmNames: ["Coffee Like", "Кофе Лайк"],
    },
  ],
  companies: [],
  sources: [
    {
      adapter: "dodo-publicapi",
      feeds: "dodo",
      cadence: "weekly",
      mode: "auto",
    },
    {
      adapter: "dodo-publicapi",
      feeds: "locations",
      chain: "dodo",
      cadence: "weekly",
      mode: "auto",
    },
    {
      adapter: "osm-overpass",
      feeds: "locations",
      cadence: "weekly",
      mode: "auto",
      checked: "2026-11-03",
    },
  ],
};
