// Разбор Overture без сети: строки-фикстуры вместо parquet из S3.
import { assertEquals } from "@std/assert";
import type { CountryConfig } from "../countries/types.ts";
import { ES } from "../countries/ES.ts";
import { PL } from "../countries/PL.ts";
import { HU } from "../countries/HU.ts";
import {
  classify,
  discover,
  dropDuplicates,
  latestRelease,
  type PlaceRow,
} from "./overture.ts";

const cfg = {
  country: "DE",
  dodoCode: "de",
  chains: [
    { key: "dodo", name: "Dodo Pizza", segment: "pizza" },
    {
      key: "dominos",
      name: "Domino's",
      segment: "pizza",
      osmBrands: ["Domino's"],
    },
    {
      key: "local",
      name: "Local",
      segment: "other",
      osmNames: ["Lokalna"],
    },
  ],
  companies: [],
  sources: [],
} as unknown as CountryConfig;

let n = 0;
// Каждая строка — своё место: свой адрес и шаг ~110 м, иначе каноническая склейка
// по одному адресу справедливо посчитает несколько строк одним заведением.
const row = (over: Partial<PlaceRow>): PlaceRow => ({
  id: `p${++n}`,
  name: null,
  brand: null,
  wikidata: null,
  category: "restaurant",
  locality: "Berlin",
  address: `Street ${n}`,
  lat: 52.5 + n * 0.001,
  lng: 13.4,
  ...over,
});
const many = (k: number, over: (i: number) => Partial<PlaceRow>) =>
  Array.from({ length: k }, (_, i) => row(over(i)));

Deno.test("#896: McCafé spelling variants belong to McDonald's in ES, PL and HU", () => {
  for (const config of [ES, PL, HU]) {
    const { points, chains } = discover([
      row({ brand: "McCafé", name: "McCafé One", address: "Road 101" }),
      row({ brand: "McCafe", name: "McCafe Two", address: "Road 102" }),
      row({ brand: "McCafé", name: "McCafé Three", address: "Road 103" }),
      row({ brand: null, name: "McCafé Four", address: "Road 104" }),
      row({ brand: "McCafeX", name: "Unrelated", address: "Road 105" }),
    ], config);
    assertEquals(points.map((p) => p.chain), [
      "mcdonalds",
      "mcdonalds",
      "mcdonalds",
      "mcdonalds",
    ], config.country);
    assertEquals(chains, [], config.country);
  }
});

Deno.test("#1113: same-address Overture rows do not inflate a chain's point count", () => {
  const first = {
    chain: "dominos",
    name: "Domino's",
    lat: 50.2943,
    lng: 18.6658,
    city: "Gliwice",
    address: "Rynek 2",
    osm_id: "first",
  };
  const result = dropDuplicates([
    first,
    {
      ...first,
      lat: 50.2958,
      address: "Rynek 2, Gliwice",
      osm_id: "duplicate",
    },
    { ...first, lat: 50.2978, address: "Rynek 3", osm_id: "different-address" },
    { ...first, chain: "pizzahut", osm_id: "different-chain" },
    { ...first, lat: 51.2943, osm_id: "different-city" },
  ]);
  assertEquals(result.map((p) => p.osm_id), [
    "first",
    "different-address",
    "different-chain",
    "different-city",
  ]);
});

Deno.test("overture: a brand with a country suffix matches the config chain by prefix", () => {
  const { points, chains } = discover(
    [
      row({ name: "Domino's", brand: "Domino's Pizza Deutschland" }),
      row({ name: "Dominos Berlin", brand: "Domino's" }),
      row({ name: "Lokalna pekara", brand: null }),
      row({ name: "X", brand: "Domino'sX" }),
    ],
    cfg,
  );
  assertEquals(points.map((p) => p.chain), ["dominos", "dominos", "local"]);
  assertEquals(chains, []);
});

Deno.test("overture: a brand needs 3 points, merged by wikidata across spellings", () => {
  const rows = [
    ...many(2, () => ({ brand: "Nordsee", wikidata: "Q1" })),
    row({ brand: "Nordsee Deutschland", wikidata: "Q1" }),
    ...many(2, () => ({ brand: "Rare Chain" })),
  ];
  const { points, chains } = discover(rows, cfg);
  assertEquals(chains.map((c) => c.name), ["Nordsee"]);
  assertEquals(chains[0].key, "nordsee");
  assertEquals(points.filter((p) => p.chain === "nordsee").length, 3);
});

Deno.test("overture: without a brand it takes 5 points in 3 localities, a generic name below that is dropped", () => {
  const cities = ["A", "B", "C", "A", "B"];
  const ok = many(5, (i) => ({ name: "Bistro Lux", locality: cities[i] }));
  const oneTown = many(6, () => ({ name: "Pizzeria", locality: "A" }));
  const few = many(4, (i) => ({ name: "Four", locality: cities[i] }));
  const { chains } = discover([...ok, ...oneTown, ...few], cfg);
  assertEquals(chains.map((c) => c.name), ["Bistro Lux"]);
});

Deno.test("overture: Dodo never becomes a discovered chain or a point", () => {
  const { points, chains } = discover(
    many(6, () => ({ brand: "Dodo Pizza", name: "Dodo Pizza" })),
    cfg,
  );
  assertEquals(points, []);
  assertEquals(chains, []);
});

Deno.test("overture: Cyrillic Dodo («Додо Пицца Беларусь») is skipped too", () => {
  const { points, chains } = discover(
    [
      ...many(6, () => ({ brand: null, name: "Додо Пицца Беларусь" })),
      ...many(6, () => ({ brand: "Додо", name: "Додо" })),
    ],
    cfg,
  );
  assertEquals(points, []);
  assertEquals(chains, []);
});

Deno.test("overture: discovered key is unique against config keys, top 40 by count", () => {
  const rows = [
    ...many(3, () => ({ brand: "Dominos Fan Club" })),
    ...Array.from(
      { length: 45 },
      (_, c) => many(3 + c, () => ({ brand: `Brand ${c}` })),
    ).flat(),
  ];
  const { chains } = discover(rows, {
    ...cfg,
    chains: [...cfg.chains, { key: "brand-44", name: "x", segment: "other" }],
  });
  assertEquals(chains.length, 40);
  assertEquals(chains[0].name, "Brand 44");
  assertEquals(chains[0].key, "brand-44-2");
});

Deno.test("overture: segment comes from the name first, then from the majority category", () => {
  assertEquals(classify("Pizzeria Roma", ["restaurant"]), "pizza");
  assertEquals(classify("Piekarnia Nowak", ["bakery"]), "bakery");
  assertEquals(classify("Döner King", []), "grill");
  assertEquals(classify("Kawiarnia Pod", []), "coffee");
  assertEquals(classify("Zorba", ["cafe", "cafe", "restaurant"]), "coffee");
  assertEquals(
    classify("Zorba", ["cafe", "restaurant", "restaurant"]),
    "other",
  );
  const { chains } = discover(
    many(3, () => ({ brand: "Piekarnia Sweet", category: "bakery" })),
    cfg,
  );
  assertEquals(chains, [
    {
      key: "piekarnia-sweet",
      name: "Piekarnia Sweet",
      segment: "bakery",
      bakery: true,
    },
  ]);
});

Deno.test("overture: latest release is the max date, then the max suffix", () => {
  const p = (r: string) => `<Prefix>release/${r}/</Prefix>`;
  assertEquals(
    latestRelease(
      p("2026-08-20.0") + p("2026-09-17.0") + p("2026-09-17.10") +
        p("2026-09-17.9"),
    ),
    "2026-09-17.10",
  );
});

Deno.test("overture: a curly apostrophe and a brandless row still hit the config chain; same-name groups merge", () => {
  const { points, chains } = discover(
    [
      row({ name: "Domino’s Pizza", brand: "Domino’s" }),
      row({ name: "Domino's Pizza Centrum", brand: null }),
      ...many(2, () => ({ brand: "Hesburger", wikidata: "Q2" })),
      row({ brand: "Hesburger" }),
    ],
    cfg,
  );
  assertEquals(points.filter((p) => p.chain === "dominos").length, 2);
  assertEquals(chains.map((c) => c.name), ["Hesburger"]);
  assertEquals(points.filter((p) => p.chain === "hesburger").length, 3);
});

Deno.test("overture: one place listed twice (same chain, within 25 m) becomes one point", () => {
  const p = (chain: string, lat: number, lng: number, id: string) => ({
    chain,
    name: chain,
    lat,
    lng,
    city: null,
    address: null,
    osm_id: id,
  });
  const out = dropDuplicates([
    p("costa", 52.2297, 21.0122, "a"),
    p("costa", 52.22975, 21.01225, "b"), // ~7 м — двойник
    p("costa", 52.2310, 21.0122, "c"), // ~145 м — другая точка
    p("kfc", 52.2297, 21.0122, "d"), // другая сеть в том же месте
  ]);
  assertEquals(out.map((x) => x.osm_id), ["a", "c", "d"]);
});
