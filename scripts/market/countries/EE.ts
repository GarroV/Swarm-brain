import type { CountryConfig } from "./types.ts";

// Эстония. Рег. коды — открытая выгрузка ariregister (разведка 02.10.2026). Франчайзи Dodo —
// по publicapi (OrganizationName). У VIP Shop есть и другой бизнес: выручка не чисто Dodo.
export const EE: CountryConfig = {
  country: "EE",
  dodoCode: "ee",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "dominos",
      name: "Domino's",
      segment: "pizza",
      osmBrands: ["Domino's", "Domino's Pizza"],
    },
    {
      key: "peetri",
      name: "Peetri Pizza",
      segment: "pizza",
      osmBrands: ["Peetri Pizza"],
    },
    {
      key: "kotipizza",
      name: "Kotipizza",
      segment: "pizza",
      osmBrands: ["Kotipizza"],
    },
    {
      key: "mcdonalds",
      name: "McDonald's",
      segment: "burger",
      osmBrands: ["McDonald's"],
    },
    {
      key: "hesburger",
      name: "Hesburger",
      segment: "burger",
      osmBrands: ["Hesburger"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    {
      key: "subway",
      name: "Subway",
      segment: "sandwich",
      osmBrands: ["Subway"],
    },
  ],
  companies: [
    { chain: "dodo", name: "Osaühing VIP Shop", regId: "11452320" },
    { chain: "dodo", name: "DigiLike OÜ", regId: "14924021" },
    { chain: "hesburger", name: "AS Hesburger", regId: "10312806" },
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
    },
    {
      adapter: "ee-ariregister",
      feeds: "financials",
      cadence: "monthly",
      mode: "auto",
    },
    {
      adapter: "manual",
      feeds: "prices",
      cadence: "manual",
      mode: "manual",
      note: "ещё не собирались",
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
