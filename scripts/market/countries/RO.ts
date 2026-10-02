import type { CountryConfig } from "./types.ts";

// Румыния. Юрлица и CUI — разведка 02.10.2026 по открытой выгрузке data.gov.ro; связь
// «юрлицо → бренд» для Dodo — по названию юрлица и publicapi (OrganizationName).
export const RO: CountryConfig = {
  country: "RO",
  dodoCode: "ro",
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
      osmBrands: ["Pizza Hut", "Pizza Hut Delivery"],
    },
    {
      key: "jerrys",
      name: "Jerry's Pizza",
      segment: "pizza",
      osmBrands: ["Jerry's Pizza"],
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
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    {
      key: "subway",
      name: "Subway",
      segment: "sandwich",
      osmBrands: ["Subway"],
    },
    {
      key: "spartan",
      name: "Spartan",
      segment: "grill",
      osmBrands: ["Spartan"],
    },
    {
      key: "saladbox",
      name: "Salad Box",
      segment: "other",
      osmBrands: ["Salad Box"],
    },
  ],
  companies: [
    { chain: "dodo", name: "Dodo Pizza Lujerului SRL", regId: "25834486" },
    { chain: "dodo", name: "Dodo Pizza Coresi SRL", regId: "22787860" },
    {
      chain: "mcdonalds",
      name: "Premier Restaurants Romania SRL",
      regId: "6205722",
    },
    // Холдинг KFC/Pizza Hut: в реестре — его отдельная отчётность (сборы с дочерних), не выручка
    // ресторанов. Операционные дочерние — кандидат на добавление после сверки CUI.
    {
      chain: "kfc",
      name: "Sphera Franchise Group SA (holding)",
      regId: "37586457",
    },
    { chain: "dominos", name: "Domino's Pizza Maxim SRL", regId: "24335356" },
    { chain: "jerrys", name: "Jerry's Pizza Est SRL", regId: "10556918" },
    { chain: "jerrys", name: "Jerry's Pizza Nord SRL", regId: "14509340" },
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
      adapter: "ro-datagov",
      feeds: "financials",
      cadence: "yearly",
      mode: "auto",
    },
    { adapter: "manual", feeds: "prices", cadence: "manual", mode: "manual" },
    { adapter: "manual", feeds: "facts", cadence: "manual", mode: "manual" },
  ],
};
