import type { CountryConfig } from "./types.ts";

// Хорватия. Сети и ключи — из анализа 01.10.2026 (первичная заливка ручных источников),
// теги OSM — для международных сетей (локальных в OSM нет, сверка 02.10.2026).
export const HR: CountryConfig = {
  country: "HR",
  dodoCode: "hr",
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
    { key: "pizzaexpress_hr", name: "Pizza Express HR", segment: "pizza" },
    {
      key: "tuttobene",
      name: "TuttoBene Pizzeria & Fast Food",
      segment: "pizza",
    },
    {
      key: "mcdonalds",
      name: "McDonald's",
      segment: "burger",
      osmBrands: ["McDonald's"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    { key: "submarine-burger", name: "Submarine Burger", segment: "burger" },
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    { key: "batak-grill", name: "Batak Grill", segment: "grill" },
    {
      key: "mlinar",
      name: "Mlinar",
      segment: "bakery",
      bakery: true,
      osmBrands: ["Mlinar"],
    },
    { key: "pan-pek", name: "Pan-Pek", segment: "bakery", bakery: true },
    {
      key: "pekara-dubravica",
      name: "Pekara Dubravica",
      segment: "bakery",
      bakery: true,
    },
    {
      key: "leggiero",
      name: "Leggiero / Leggiero Food",
      segment: "coffee",
      bakery: true,
    },
    { key: "gyotaku", name: "Gyotaku", segment: "asian" },
    { key: "koykan", name: "Koykan", segment: "asian" },
    { key: "purple-monkey", name: "Purple Monkey", segment: "asian" },
    { key: "umami", name: "Umami", segment: "asian" },
    { key: "wok-me", name: "Wok Me", segment: "asian" },
    { key: "good-food", name: "Good Food", segment: "other" },
    { key: "biberon", name: "Biberon Food", segment: "other" },
    { key: "foodie", name: "Foodie", segment: "other" },
    { key: "pasta-fasta", name: "Pasta Fasta", segment: "other" },
  ],
  // Финансы Хорватии — ручной источник (Fina), юрлица приходят снимком.
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
    },
    {
      adapter: "manual",
      feeds: "locations",
      cadence: "manual",
      mode: "manual",
    },
    {
      adapter: "manual",
      feeds: "financials",
      cadence: "manual",
      mode: "manual",
      reason:
        "Fina Info.BIZ: вход по учётной записи, условия запрещают перепубликацию — обновление раз в год вручную",
    },
    { adapter: "manual", feeds: "prices", cadence: "manual", mode: "manual" },
    { adapter: "manual", feeds: "facts", cadence: "manual", mode: "manual" },
  ],
};
