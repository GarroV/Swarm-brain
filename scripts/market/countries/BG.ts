import type { CountryConfig } from "./types.ts";

// Болгария. Разведка 03.10.2026 по OSM (все fast_food/restaurant/cafe/bakery страны) и Dodo
// publicapi: у международных и крупных местных сетей есть тег brand, у Skapto и King's Bakery —
// только name. Отчётность юрлиц бесплатно и без входа не отдаёт никто (papagal — защита от ботов,
// companybook и finansi — платно за 2024–2025), поэтому финансов в автоматике нет — вопрос
// владельцу. С 2026 года страна в евро; отчётность 2025 и раньше — в левах.
export const BG: CountryConfig = {
  country: "BG",
  dodoCode: "bg",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "dominos",
      name: "Domino's",
      segment: "pizza",
      osmBrands: ["Domino's", "Domino's Pizza"],
    },
    {
      key: "papajohns",
      name: "Papa John's",
      segment: "pizza",
      osmBrands: ["Papa John's"],
    },
    {
      key: "pizzalab",
      name: "Pizza Lab",
      segment: "pizza",
      osmBrands: ["Pizza Lab"],
    },
    {
      key: "mcdonalds",
      name: "McDonald's",
      segment: "burger",
      osmBrands: ["McDonald's", "McDonalds", "Макдоналдс"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    {
      key: "hesburger",
      name: "Hesburger",
      segment: "burger",
      osmBrands: ["Hesburger"],
    },
    {
      key: "skapto",
      name: "Skapto",
      segment: "burger",
      osmNames: ["Skapto", "Скапто"],
    },
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    {
      key: "subway",
      name: "Subway",
      segment: "sandwich",
      osmBrands: ["Subway"],
    },
    {
      key: "go-grill",
      name: "GO Grill",
      segment: "grill",
      osmBrands: ["GO Grill"],
    },
    {
      key: "happy",
      name: "Happy Bar & Grill",
      segment: "grill",
      osmBrands: ["Happy Bar & Grill"],
    },
    {
      key: "aladin",
      name: "Aladin Foods",
      segment: "other",
      osmBrands: ["Aladin Foods"],
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
      osmBrands: ["Costa"],
    },
    {
      key: "fornetti",
      name: "Fornetti",
      segment: "bakery",
      bakery: true,
      osmBrands: ["Fornetti"],
    },
    {
      key: "sofiyska-banitsa",
      name: "Sofiyska banitsa",
      segment: "bakery",
      bakery: true,
      osmBrands: ["Софийска баница"],
    },
    {
      key: "kings-bakery",
      name: "King's Bakery",
      segment: "bakery",
      bakery: true,
      osmNames: ["King's Bakery"],
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
      checked: "2026-10-03",
    },
    {
      adapter: "manual",
      feeds: "financials",
      cadence: "manual",
      mode: "manual",
      url: "Търговски регистър (registryagency.bg) — годовые отчёты PDF",
      note:
        "бесплатного машинного источника нет: papagal.bg за защитой от ботов, companybook.bg и finansi.bg — 2024–2025 платно; вопрос владельцу",
    },
    {
      adapter: "manual",
      feeds: "prices",
      cadence: "manual",
      mode: "manual",
      url: "Wolt / Glovo (JSON меню по slug заведения, без входа)",
      note: "ещё не собирались; кандидат в автоматический адаптер",
    },
    {
      adapter: "manual",
      feeds: "facts",
      cadence: "manual",
      mode: "manual",
      note: "ещё не собирались; ручной части нет",
    },
  ],
};
