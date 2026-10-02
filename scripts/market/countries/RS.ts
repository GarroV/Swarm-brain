import type { CountryConfig } from "./types.ts";

// Сербия. Разведка 02.10.2026 (workbench/private/market/RS/research.md): сети и число точек —
// OSM, Wolt, пресса; у локальных сетей тега brand в OSM нет — ищем по началу name (латиница и
// кириллица). Отчётность APR закрыта капчей, итоги юрлиц — страницы CompanyWall (данные APR).
// Нет в стране: Domino's (только пустое юрлицо), Subway, Popeyes, Papa John's. Burger King
// открывает первый ресторан осенью 2026 (Ušće, оператор Danubian d.o.o., отчётности ещё нет).
export const RS: CountryConfig = {
  country: "RS",
  dodoCode: "rs",
  currency: "RSD",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "pizzahut",
      name: "Pizza Hut",
      segment: "pizza",
      osmBrands: ["Pizza Hut"],
    },
    {
      key: "caribic",
      name: "Caribic Pizza",
      segment: "pizza",
      osmNames: ["Caribic", "Карибик"],
    },
    {
      key: "mcdonalds",
      name: "McDonald's",
      segment: "burger",
      osmBrands: ["McDonald's", "McDonalds", "Мекдоналдс", "Макдоналдс"],
    },
    {
      key: "burgerking",
      name: "Burger King",
      segment: "burger",
      osmBrands: ["Burger King"],
    },
    { key: "kfc", name: "KFC", segment: "chicken", osmBrands: ["KFC"] },
    {
      key: "walter",
      name: "Walter",
      segment: "grill",
      osmNames: ["Walter", "Валтер"],
    },
    {
      key: "tacobell",
      name: "Taco Bell",
      segment: "other",
      osmBrands: ["Taco Bell"],
    },
    {
      key: "burrito-madre",
      name: "Burrito Madre",
      segment: "other",
      osmNames: ["Burrito Madre"],
    },
    {
      key: "starbucks",
      name: "Starbucks",
      segment: "coffee",
      osmBrands: ["Starbucks", "Старбакс"],
    },
    {
      key: "skroz-dobra-pekara",
      name: "Skroz dobra pekara",
      segment: "bakery",
      bakery: true,
      osmNames: ["Skroz dobra pekara", "Скроз добра пекара"],
    },
    {
      key: "hleb-i-kifle",
      name: "Hleb i kifle",
      segment: "bakery",
      bakery: true,
      osmNames: ["Hleb i kifle", "Хлеб и кифле"],
    },
    {
      key: "zlatni-klas",
      name: "Zlatni klas",
      segment: "bakery",
      bakery: true,
      osmNames: ["Zlatni klas", "Златни клас"],
    },
  ],
  companies: [
    {
      chain: "dodo",
      name: "Anton Nefedev PR Picerije ANGARA",
      regId: "66479366",
      url: "https://www.companywall.rs/firma/anton-nefedev-pr-angara/MMx3sfwtq",
    },
    {
      chain: "mcdonalds",
      name: "Nicefoods Restorani d.o.o.",
      regId: "07092652",
      url: "https://www.companywall.rs/firma/nicefoods-doo-beograd/MMkWPVBD",
    },
    {
      chain: "kfc",
      name: "AmRest d.o.o.",
      regId: "20343052",
      url: "https://www.companywall.rs/firma/amrest-doo/MMuTuFvq",
    },
    {
      chain: "starbucks",
      name: "AmRest Coffee SRB d.o.o.",
      regId: "21335517",
      url: "https://www.companywall.rs/firma/amrest-coffee-srb-doo/MMyzevgq",
    },
    {
      chain: "walter",
      name: "Walter BBQ d.o.o.",
      regId: "21093564",
      url:
        "https://www.companywall.rs/firma/walter-bbq-doo-beograd-rakovica/MMjqrIRC",
    },
    {
      chain: "caribic",
      name: "MMM Pizza Group d.o.o.",
      regId: "20526068",
      url:
        "https://www.companywall.rs/firma/mmm-pizza-group-doo-novi-sad/MMrCN4Pq",
    },
    {
      chain: "skroz-dobra-pekara",
      name: "Trgocentar d.o.o.",
      regId: "07773820",
      url: "https://www.companywall.rs/firma/trgocentar-doo-beograd/MMkTSQYR",
    },
    {
      chain: "hleb-i-kifle",
      name: "Hleb i kifle d.o.o.",
      regId: "20301708",
      url: "https://www.companywall.rs/firma/hleb-i-kifle/MMpfS7gq",
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
        "общие доходы (Ukupni prihodi) — шире выручки от продаж; выручки от продаж (poslovni prihodi) есть только в APR (fin.apr.gov.rs) за капчей",
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
