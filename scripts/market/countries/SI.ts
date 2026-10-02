import type { CountryConfig } from "./types.ts";

// Словения. Разведка 02.10.2026 по OSM (все fast_food/restaurant/cafe/bakery страны) и Dodo
// publicapi: международные сети с тегом brand — McDonald's (у него несколько франчайзи, единого
// юрлица нет), KFC, Burger King, Subway; локальные сети без тега — по началу name. Domino's и
// Pizza Hut в стране нет. Итоги юрлиц — страницы CompanyWall (данные AJPES): «Celotni prihodki» —
// все доходы, шире выручки от продаж.
export const SI: CountryConfig = {
  country: "SI",
  dodoCode: "si",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
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
      key: "hood-burger",
      name: "Hood Burger",
      segment: "burger",
      osmNames: ["Hood Burger"],
    },
    {
      key: "hot-horse",
      name: "Hot Horse",
      segment: "burger",
      osmNames: ["Hot Horse"],
    },
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    {
      key: "subway",
      name: "Subway",
      segment: "sandwich",
      osmBrands: ["Subway"],
    },
    {
      key: "chutys",
      name: "Chuty's",
      segment: "other",
      osmNames: ["Chuty's", "Chutys"],
    },
    {
      key: "pecjak",
      name: "Pekarna Pečjak",
      segment: "bakery",
      bakery: true,
      osmNames: ["Pekarna Pečjak", "Pečjak"],
    },
    {
      key: "zito",
      name: "Žito",
      segment: "bakery",
      bakery: true,
      osmNames: ["Žito", "Pekarna Žito"],
    },
    {
      key: "brumat",
      name: "Pekarna Brumat",
      segment: "bakery",
      bakery: true,
      osmNames: ["Pekarna Brumat", "Brumat"],
    },
    {
      key: "mlinar",
      name: "Mlinar",
      segment: "bakery",
      bakery: true,
      osmBrands: ["Mlinar"],
      osmNames: ["Mlinar", "Pekarna Mlinar"],
    },
  ],
  companies: [
    {
      chain: "dodo",
      name: "Fovella d.o.o.",
      regId: "8065152000",
      url: "https://www.companywall.si/podjetje/fovella-doo/MM72sn0D",
    },
    {
      chain: "chutys",
      name: "Chutis d.o.o.",
      regId: "6414184000",
      url: "https://www.companywall.si/podjetje/chutis-doo/MMX8PjR",
    },
    {
      chain: "hot-horse",
      name: "Hot - Horse d.o.o.",
      regId: "5873525000",
      url: "https://www.companywall.si/podjetje/hot---horse-doo/MMxGcdgD",
    },
    {
      chain: "pecjak",
      name: "Pekarna Pečjak d.o.o.",
      regId: "5879612000",
      url: "https://www.companywall.si/podjetje/pekarna-pecjak-doo/MM1db3F0",
    },
    {
      chain: "brumat",
      name: "Pekarna Brumat d.o.o.",
      regId: "5986613000",
      url: "https://www.companywall.si/podjetje/pekarna-brumat-doo/MM1dJYVR",
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
      checked: "2026-10-02",
    },
    {
      adapter: "companywall",
      feeds: "financials",
      cadence: "yearly",
      mode: "auto",
      note:
        "все доходы (Celotni prihodki, AJPES) — шире выручки от продаж; у McDonald's несколько франчайзи, юрлица сети нет",
      checked: "2026-10-02",
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
