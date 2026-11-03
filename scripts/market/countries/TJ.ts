import type { CountryConfig } from "./types.ts";

// Таджикистан. Разведка 03.11.2026: сетей почти нет ни в Overture (4 точки), ни в OSM (1025
// заведений с именем, из сетей — KFC 5, TajBurger 3, SFC 2, Шоколадница 2). Карта — OSM
// (overpass); сетей из конфига ищем по бренду или началу name. Общие названия («Ошхона»,
// «Чойхона», «Кафе») сетью не считаем. Отчётность юрлиц не собираем (companies пусто).
export const TJ: CountryConfig = {
  country: "TJ",
  dodoCode: "tj",
  currency: "TJS",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "kfc",
      name: "KFC",
      segment: "chicken",
      osmBrands: ["KFC"],
    },
    {
      key: "tajburger",
      name: "TajBurger",
      segment: "burger",
      osmNames: ["TajBurger", "Taj Burger"],
    },
    {
      key: "sfc",
      name: "Southern Fried Chicken",
      segment: "chicken",
      osmNames: ["Southern Fried Chicken", "SFC"],
    },
    {
      key: "shokoladnitsa",
      name: "Шоколадница",
      segment: "coffee",
      osmBrands: ["Шоколадница"],
      osmNames: ["Шоколадница"],
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
