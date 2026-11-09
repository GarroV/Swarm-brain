import type { CountryConfig } from "./types.ts";

// Беларусь. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// Dodo и международные сети, остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const BY: CountryConfig = {
  country: "BY",
  dodoCode: "by",
  currency: "BYN",
  mapSource: "overture",
  bbox: [23.17, 51.24, 32.72, 56.16],
  // Фирменные магазины кондитерских фабрик — не общепит (решение владельца 07.11.2026, #1134).
  manufacturerShops: {
    "Красный пищевик": "кондитерская фабрика, фирменные магазины",
    "Коммунарка": "кондитерская фабрика, фирменные магазины и кофейни",
    "Слодыч": "кондитерская фабрика, фирменные павильоны",
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
    // Один бренд под несколькими подписями в Overture (#1113): без записи каждая заводилась своей сетью.
    {
      key: "kofe-saund",
      name: "Кофе Саунд",
      segment: "coffee",
      osmBrands: ["Кофе Саунд", 'Сеть кофеен "Кофе Саунд"'],
      osmNames: ['Кофейня "Кофе Саунд"'],
    },
    {
      key: "garage",
      name: "Garage",
      segment: "coffee",
      osmBrands: ["Garage"],
      osmNames: ["Гараж"],
    },
    {
      // Бренд в Overture записан с турецким названием города, заведения называются «Terra Pizza».
      key: "terra-pizza",
      name: "Terra Pizza",
      segment: "pizza",
      osmBrands: ["Terra pizza İskenderun"],
      osmNames: ["Terra Pizza"],
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
