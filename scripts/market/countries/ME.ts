import type { CountryConfig } from "./types.ts";

// Черногория. Разведка 03.10.2026 по OSM (все fast_food/restaurant/cafe/bakery страны) и Dodo
// publicapi: рынок маленький, международные сети — Burger King и одна Pizza Hut; McDonald's, KFC,
// Domino's и Subway в стране нет. Локальные сети без тега brand — по началу name. Pekara
// Montenegro разбита на много юрлиц (PG 1, 3, 4, B&T…), выручки сети нет. Итоги юрлиц — страницы
// CompanyWall (данные налоговой): «Ukupni prihodi» — все доходы, сотрудники только за последний год.
export const ME: CountryConfig = {
  country: "ME",
  dodoCode: "me",
  cityScript: "sr-Latn",
  osmExclude: {
    // В OSM «Pizza hut», на картах Google — «Pizza Hutt Ulqin», Donji Štoj: местная пиццерия,
    // не сеть (владелец, 03.10.2026). Pizza Hut в Черногории не найдена.
    "node/12989476482": "местная «Pizza Hutt Ulqin», не сеть",
  },
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "pizzahut",
      name: "Pizza Hut",
      segment: "pizza",
      osmBrands: ["Pizza Hut"],
      osmNames: ["Pizza Hut"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    {
      key: "walter",
      name: "Walter",
      segment: "grill",
      osmNames: ["Walter", "Валтер"],
    },
    {
      key: "caffeine",
      name: "Caffeine Coffee Shop",
      segment: "coffee",
      osmNames: ["Caffeine Coffee Shop", "Caffeine"],
    },
    {
      key: "pekara-montenegro",
      name: "Pekara Montenegro",
      segment: "bakery",
      bakery: true,
      osmNames: ["Pekara Montenegro"],
    },
    {
      key: "pekara-sicilia",
      name: "Pekara Sicilia",
      segment: "bakery",
      bakery: true,
      osmNames: ["Pekara Sicilia"],
    },
  ],
  companies: [
    {
      chain: "dodo",
      name: "Food V. d.o.o.",
      regId: "03671429",
      url: "https://www.companywall.me/firma/food-v-doo/MMEX2Htq",
    },
    {
      chain: "caffeine",
      name: "Caffeine Company d.o.o.",
      regId: "03075966",
      url: "https://www.companywall.me/firma/caffeine-company/MMUpnSY",
    },
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
      adapter: "companywall",
      feeds: "financials",
      cadence: "yearly",
      mode: "auto",
      note:
        "все доходы (Ukupni prihodi, налоговая) — шире выручки от продаж; сотрудники только за последний год; у Pekara Montenegro много юрлиц",
      checked: "2026-10-03",
    },
    {
      adapter: "manual",
      feeds: "prices",
      cadence: "manual",
      mode: "manual",
      url: "Wolt (JSON меню по slug заведения, без входа)",
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
