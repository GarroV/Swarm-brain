import type { CountryConfig } from "./types.ts";

// Испания. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// Dodo и международные сети, остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const ES: CountryConfig = {
  country: "ES",
  dodoCode: "es",
  // API отдаёт LocalityName «L'Escala», хотя адрес — Terrassa (Carrer de la Torre, 31).
  dodoCity: { "Terrassa-1": "Terrassa" },
  mapSource: "overture",
  bbox: [-18.17, 27.64, 4.34, 43.79],
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
    {
      key: "llaollao",
      name: "llaollao",
      segment: "other",
      // Одна сеть: Overture держит часть магазинов Испании под «llaollao Saudi Arabia» / «llaollao Taiwan»
      // (бренды мастер-франшиз), отдельными «сетями» они не считаются.
      osmBrands: ["llaollao"],
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
