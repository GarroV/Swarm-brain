import type { CountryConfig } from "./types.ts";

// Кипр. Карта и сети — из Overture Maps (адаптер overture, без ручных загрузок): в конфиге только
// Dodo и международные сети, остальные сети адаптер находит сам по бренду и числу точек.
// Отчётность юрлиц не собираем (companies пусто).
export const CY: CountryConfig = {
  country: "CY",
  dodoCode: "cy",
  mapSource: "overture",
  bbox: [32.27, 34.63, 34.1, 35.19],
  // Фирменные магазины производителей — не общепит (решение владельца 07.11.2026, #1134).
  manufacturerShops: {
    "Pralina Confectioneries": "кондитерская фабрика, фирменные магазины",
    "Leonidas": "шоколадная фабрика, фирменные магазины",
  },
  // Север острова (Лефкоша, Кирения-Лефке, Фамагуста) не контролируется Республикой Кипр: bbox его
  // захватывает, а Overture ставит там заведения под теми же брендами («Domino's» в Лефкоше и
  // Фамагусте). Кольца приблизительные по линии прекращения огня (±300 м), выверены по 555 точкам
  // прода: 16 внутри — все северные, южных внутри нет (#1113).
  excludeAreas: [
    {
      name: "Северная Никосия, Лефке",
      reason: "территория вне контроля Республики Кипр",
      ring: [
        [32.72, 35.35],
        [32.72, 35.09],
        [32.78, 35.07],
        [32.84, 35.095],
        [32.9, 35.125],
        [32.97, 35.15],
        [33.05, 35.16],
        [33.2, 35.165],
        [33.25, 35.168],
        [33.33, 35.178],
        [33.345, 35.18],
        [33.358, 35.176],
        [33.368, 35.177],
        [33.38, 35.188],
        [33.4, 35.2],
        [33.4, 35.35],
      ],
    },
    {
      name: "Фамагуста, Карпасия-юг, аэропорт Эрджан",
      reason: "территория вне контроля Республики Кипр",
      ring: [
        [33.45, 35.35],
        [33.45, 35.17],
        [33.48, 35.13],
        [33.55, 35.1],
        [33.62, 35.07],
        [33.68, 35.04],
        [33.75, 35.05],
        [33.85, 35.07],
        [33.93, 35.075],
        [33.99, 35.075],
        [34.15, 35.075],
        [34.15, 35.35],
      ],
    },
  ],
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
      key: "coffee-island",
      name: "Coffee Island",
      segment: "coffee",
      // Одна сеть: у части кипрских точек в названии стоит греческий адрес франшизы («Coffee Island Θεσσαλονίκη…»).
      osmBrands: ["Coffee Island"],
    },
    {
      // Overture держит сеть под двумя брендами («Mikel Larnaca», «Mikel Coffee Company Cyprus»).
      key: "mikel",
      name: "Mikel Coffee",
      segment: "coffee",
      osmBrands: [
        "Mikel Coffee Company",
        "Mikel Larnaca",
        "Mikel Coffee",
        "Mikel",
      ],
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
