import type { CountryConfig } from "./types.ts";

// Латвия. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// международные сети (Dodo в стране нет), остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const LV: CountryConfig = {
  country: "LV",
  mapSource: "overture",
  bbox: [20.97, 55.67, 28.24, 57.97],
  chains: [
    {
      key: "dominos",
      name: "Domino's",
      segment: "pizza",
      osmBrands: ["Domino's", "Domino's Pizza"],
    },
    {
      key: "pizzahut",
      name: "Pizza Hut",
      segment: "pizza",
      osmBrands: ["Pizza Hut"],
    },
    {
      key: "mcdonalds",
      name: "McDonald's",
      segment: "burger",
      osmBrands: ["McDonald's", "McDonalds"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    {
      key: "kfc",
      name: "KFC",
      segment: "chicken",
      osmBrands: ["KFC"],
    },
    {
      key: "subway",
      name: "Subway",
      segment: "sandwich",
      osmBrands: ["Subway"],
    },
    {
      key: "starbucks",
      name: "Starbucks",
      segment: "coffee",
      osmBrands: ["Starbucks"],
    },
    {
      key: "costa",
      name: "Costa Coffee",
      segment: "coffee",
      osmBrands: ["Costa Coffee", "Costa"],
    },
    {
      key: "hesburger",
      name: "Hesburger",
      segment: "burger",
      osmBrands: ["Hesburger"],
    },
    {
      key: "lido",
      name: "Lido",
      segment: "other",
      osmNames: ["Lido"],
    },
    {
      key: "cili",
      name: "Čili Pizza",
      segment: "pizza",
      osmBrands: ["Čili Pizza", "Čili Pica"],
    },
    {
      key: "pica-lulu",
      name: "Pica Lulū",
      segment: "pizza",
      osmBrands: ["Pica Lulū"],
    },
  ],
  companies: [],
  sources: [
    {
      adapter: "manual",
      feeds: "dodo",
      cadence: "manual",
      mode: "blocked",
      reason:
        "Dodo в Латвии нет: publicapi.dodois.io/lv отвечает 404 (проверено 03.11.2026)",
    },
    {
      adapter: "overture",
      feeds: "locations",
      cadence: "weekly",
      mode: "auto",
      checked: "2026-11-03",
    },
  ],
};
