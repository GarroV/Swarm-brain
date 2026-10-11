import type { CountryConfig } from "./types.ts";

// Болгария. Разведка 03.10.2026 по OSM (все fast_food/restaurant/cafe/bakery страны) и Dodo
// publicapi: у международных и крупных местных сетей есть тег brand, у Skapto и King's Bakery —
// только name. Финансы юрлиц собирает адаптер bg-registry из годовых отчётов Търговски регистър
// (бесплатно, без входа; PDF в основном сканы, их читает tesseract): публикуется только
// подтверждённая выручка (правило — scripts/market/bg-registry.ts). Платные базы (companybook,
// finansi) не берём (решение 03.10), papagal закрыт защитой от ботов. Юрлица заведены не у всех
// сетей: у Happy, Subway и Dodo их нет. С 2026 года страна в евро; отчётность 2025 и раньше — в левах.
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
  companies: [
    { chain: "mcdonalds", name: "Сънфудс България ЕООД", regId: "831507493" },
    { chain: "kfc", name: "АмРест ЕООД", regId: "175297584" },
    { chain: "starbucks", name: "АмРест Кофи", regId: "175395555" },
    { chain: "hesburger", name: "Бългериан Бургер", regId: "204078386" },
    { chain: "aladin", name: "Аладин Фуудс ООД", regId: "115271421" },
    { chain: "fornetti", name: "Форнетти България ЕООД", regId: "175212388" },
    { chain: "pizzalab", name: "Фили Вайб АД", regId: "203418843" },
  ],
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
      adapter: "bg-registry",
      feeds: "financials",
      cadence: "yearly",
      mode: "auto",
      url:
        "Търговски регистър (portal.registryagency.bg) — годовые финансовые отчёты PDF",
      note:
        "выручка из строки «Приходи от продажби»; публикуется подтверждённая (текстовый слой или совпадение с отчётом следующего года), левы → евро по 1,95583",
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
