import type { CountryConfig } from "./types.ts";

// Польша. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// Dodo и международные сети, остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const PL: CountryConfig = {
  country: "PL",
  dodoCode: "pl",
  currency: "PLN",
  mapSource: "overture",
  bbox: [14.12, 48.99, 24.14, 54.84],
  // Фирменные магазины производителей — не общепит (решение владельца 07.11.2026, #1134).
  manufacturerShops: {
    "Pijalnia Czekolady E.Wedel": "фирменные шоколадные салоны фабрики Wedel",
    "Lindt": "шоколадная фабрика, фирменные магазины",
    "Karmello": "шоколадная мануфактура, фирменные магазины",
  },
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
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
    // Известные фастфуд-сети, которые автопоиск не находит (категория restaurant или нет бренда) —
    // решение владельца 10.11.2026.
    { key: "da-grasso", name: "Da Grasso", segment: "pizza", osmBrands: ["Da Grasso"], osmNames: ["Da Grasso"] },
    { key: "pasibus", name: "Pasibus", segment: "burger", osmBrands: ["Pasibus"], osmNames: ["Pasibus"] },
    { key: "gruby-benek", name: "Gruby Benek", segment: "other", osmNames: ["Gruby Benek", "Pizzeria Gruby Benek"] },
    { key: "kebab-king", name: "Kebab King", segment: "grill", osmNames: ["Kebab King"] },
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
      adapter: "overture",
      feeds: "locations",
      cadence: "weekly",
      mode: "auto",
      checked: "2026-10-11",
    },
  ],
};
