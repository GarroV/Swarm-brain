import type { CountryConfig } from "./types.ts";

// Литва. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// Dodo и международные сети, остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const LT: CountryConfig = {
  country: "LT",
  dodoCode: "lt",
  mapSource: "overture",
  bbox: [20.92, 53.89, 26.8, 56.44],
  // Фирменные магазины производителей — не общепит (решение владельца 07.11.2026, #1134).
  manufacturerShops: {
    "AJ Šokoladas": "шоколадная мануфактура, фирменные магазины",
    "Ali šokoladinė": "шоколадная мануфактура, фирменные магазины",
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
    // Одна сеть под тремя подписями в Overture (#1113): «Čili Pizza», «Čili Pizza Lietuva», «Čili Pica».
    {
      key: "cili-pizza-lietuva",
      name: "Čili Pizza",
      segment: "pizza",
      osmBrands: ["Čili Pizza Lietuva", "Čili Pizza", "Čili Pica"],
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
      adapter: "overture",
      feeds: "locations",
      cadence: "weekly",
      mode: "auto",
      checked: "2026-10-11",
    },
  ],
};
