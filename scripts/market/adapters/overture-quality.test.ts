// #1113 / #1134: качество точек Overture на строках, снятых с реального релиза 2026-10-21.0
// (названия, бренды, координаты — как в parquet; адреса и города сокращены).
import { assertEquals } from "@std/assert";
import { BY } from "../countries/BY.ts";
import { CY } from "../countries/CY.ts";
import { LT } from "../countries/LT.ts";
import { PL } from "../countries/PL.ts";
import { discover, type PlaceRow } from "./overture.ts";
import {
  clusterName,
  inRing,
  nameFitsBrand,
  sameBrandRoot,
  tokens,
} from "./overture-names.ts";

let n = 0;
const row = (over: Partial<PlaceRow>): PlaceRow => ({
  id: `q${++n}`,
  name: null,
  brand: null,
  wikidata: null,
  category: "fast_food_restaurant",
  locality: "Warszawa",
  address: `Street ${n}`,
  lat: 52.0 + n * 0.01,
  lng: 21.0,
  ...over,
});
const chainsOf = (r: ReturnType<typeof discover>, key: string) =>
  r.points.filter((p) => p.chain === key);

Deno.test("#1113 PL: foreign venues carrying the Domino's brand are dropped, real Domino's and Costa-by-location stay", () => {
  const foreign = [
    ["Pizza Dominium", "Warszawa"],
    ["Crazy Piramid Pizza", "Działdowo"],
    ["Domino Pizza i Kebab", "Lipsko"],
    ["Domino Pizza Włoska", "Działdowo"],
    ["Pizzeria Domino Kcynia", "Kcynia"],
  ].map(([name, locality]) =>
    row({
      name,
      brand: "Domino's Pizza",
      locality,
      category: "pizza_restaurant",
    })
  );
  const real = [
    row({
      name: "Domino's Pizza",
      brand: "Domino's Pizza",
      locality: "Kraków",
    }),
    row({
      name: "Domino's Pizza - Galeria Kazimierz",
      brand: "Domino's Pizza",
      locality: "Kraków",
    }),
    row({ name: "Dominos Pizza", brand: "Domino's Pizza", locality: "Gdańsk" }),
  ];
  const costa = [
    row({
      name: "Bonarka City Center",
      brand: "Costa Coffee",
      locality: "Kraków",
      category: "coffee_shop",
    }),
    row({
      name: "PKP Szczecin",
      brand: "Costa Coffee",
      locality: "Szczecin",
      category: "coffee_shop",
    }),
  ];
  const r = discover([...foreign, ...real, ...costa], PL);
  assertEquals(chainsOf(r, "dominos").map((p) => p.name).sort(), [
    "Domino's Pizza",
    "Domino's Pizza - Galeria Kazimierz",
    "Dominos Pizza",
  ]);
  assertEquals(chainsOf(r, "costa").length, 2);
  assertEquals(r.chains, []);
});

Deno.test("#1113 BY: a Domino's row named by its Cyrillic address keeps the brand", () => {
  const r = discover(
    [row({
      name: "Минск, Рафиева, 64",
      brand: "Domino's Pizza Беларусь",
      locality: "Мінск",
    })],
    BY,
  );
  assertEquals(chainsOf(r, "dominos").length, 1);
});

Deno.test("#1113 CY: places north of the ceasefire line are not collected, the south stays", () => {
  const at = (name: string, brand: string | null, lng: number, lat: number) =>
    row({ name, brand, lng, lat, address: `${name} ${lng}`, locality: "x" });
  const north = [
    at("Domino's Pizza Cyprus", "Domino's Pizza", 33.3578, 35.1821), // Лефкоша, Osmanpaşa Cd
    at("Burger King", "Burger King", 33.351, 35.186), // Лефкоша, Mehmet Akif Cd
    at("Burger King", "Burger King", 33.9305, 35.1217), // Гази-Мағуса
    at("Gloria Jean's Coffees", null, 32.8296, 35.1406), // Гемиконаӂы
    at("Gloria Jean's Coffee's", null, 33.5036, 35.1572), // аэропорт Эрджан
  ];
  const south = [
    at("Domino's Pizza - Strovolos", "Domino's Pizza", 33.3453, 35.1445),
    at("Pizza Hut", "Pizza Hut", 33.2792, 35.1346), // «Madrid Street 2, Lefkoşa» — адрес по-турецки, место южное
    at("Pizza Hut", "Pizza Hut", 33.5843, 34.8556), // «Çite» — деревня на юге
    at("Burger King", "Burger King", 34.0004, 34.9882), // Айя-Напа, ближайшая к северу
    at("Domino's Pizza", "Domino's Pizza", 33.3334, 35.1747), // Агиос-Дометиос, вплотную к линии
  ];
  const r = discover([...north, ...south], CY);
  assertEquals(r.points.length, south.length);
  assertEquals(
    r.points.map((p) => p.osm_id).sort(),
    south.map((s) => s.id).sort(),
  );
});

Deno.test("#1113 CY: one brand written with different suffixes is one discovered chain with a common name", () => {
  const kawacom = (brand: string, k: number) =>
    row({
      name: "Kawacom's Ipanema Espresso",
      brand,
      locality: `City${k % 3}`,
    });
  const rows = [
    ...[0, 1, 2].map((k) =>
      kawacom("Kawacom's Ipanema Espresso Lakatamias", k)
    ),
    ...[0, 1, 2].map((k) => kawacom("Kawacom's Ipanema Espresso Kiti", k)),
    ...[0, 1].map((k) =>
      kawacom("Kawacom's Ipanema Espresso Kokkinotrimithia", k)
    ),
  ];
  const r = discover(rows, CY);
  assertEquals(r.chains.map((c) => c.key), ["kawacom-s-ipanema-espresso"]);
  assertEquals(r.chains[0].name, "Kawacom's Ipanema Espresso");
  assertEquals(r.points.length, 8);
});

Deno.test("#1113 BY/CY: «Nravizza» + «Nravizza Pizza» and an article head («La Croissanterie …») merge", () => {
  const rows = [
    ...[0, 1, 2].map((k) =>
      row({ name: "Nravizza", brand: "Nravizza", locality: `Г${k}` })
    ),
    ...[0, 1].map((k) =>
      row({
        name: "Nravizza Pizza",
        brand: "Nravizza Pizza",
        locality: `Г${k}`,
      })
    ),
    ...[0, 1].map((k) =>
      row({
        name: "La Croissanterie",
        brand: "La Croissanterie France",
        locality: `C${k}`,
      })
    ),
    ...[0, 1, 2].map((k) =>
      row({
        name: "La Croissanterie",
        brand: "La Croissanterie - Cyprus",
        locality: `C${k}`,
      })
    ),
  ];
  const r = discover(rows, { ...CY, excludeAreas: [], chains: [] });
  assertEquals(r.chains.map((c) => c.key).sort(), [
    "la-croissanterie",
    "nravizza",
  ]);
  assertEquals(chainsOf(r, "nravizza").length, 5);
  assertEquals(chainsOf(r, "la-croissanterie").length, 5);
});

Deno.test("#1113: a head word shared by many labels is a kind of venue, not a chain («Złota Chata …» ×6 stays 6 venues)", () => {
  const rows = ["Anna", "Bartek", "Celina", "Dorota", "Edyta", "Filip"].flatMap(
    (who) =>
      [0, 1, 2].map((k) =>
        row({
          name: `Złota Chata ${who}`,
          brand: `Złota Chata ${who}`,
          locality: `L${k}`,
        })
      ),
  );
  const r = discover(rows, { ...PL, chains: [] });
  // Шесть самостоятельных групп по 3 точки; общего «Złota Chata» на 18 точек нет.
  assertEquals(r.chains.length, 6);
  assertEquals(Math.max(...r.chains.map((c) => chainsOf(r, c.key).length)), 3);
  // Два-три варианта подписи с общим началом — одна сеть.
  const few = ["Anna", "Bartek", "Celina"].flatMap((who) =>
    [0, 1].map((k) =>
      row({
        name: `Złota Chata ${who}`,
        brand: `Złota Chata ${who}`,
        locality: `L${k}`,
      })
    )
  );
  assertEquals(discover(few, { ...PL, chains: [] }).chains.map((c) => c.name), [
    "Złota Chata",
  ]);
});

Deno.test("#1113: «Pizza Mia» and «Pizza Mine» are different chains (the shared head is a kind word)", () => {
  assertEquals(sameBrandRoot(tokens("Pizza Mia"), tokens("Pizza Mine")), false);
  assertEquals(
    sameBrandRoot(tokens("Pizza Mia"), tokens("Pizza Mia Nicosia")),
    true,
  );
  assertEquals(sameBrandRoot(tokens("Tony Roma's"), tokens("Tony")), false); // короткое имя — не корень
  assertEquals(
    sameBrandRoot(tokens("Nravizza"), tokens("Nravizza Pizza")),
    true,
  );
});

Deno.test("#1113 config: scattered spellings of one brand land on one configured chain key", () => {
  const by = discover(
    [
      row({
        name: "Terra Pizza",
        brand: "Terra pizza İskenderun",
        locality: "Мінск",
      }),
      row({
        name: "Terra Pizza Академия",
        brand: "Terra pizza İskenderun",
        locality: "Мінск",
      }),
    ],
    BY,
  );
  assertEquals(chainsOf(by, "terra-pizza").length, 2);
  assertEquals(by.chains, []);
  const lt = discover(
    [
      row({
        name: "Čili Pizza",
        brand: "Čili Pizza Lietuva",
        locality: "Vilnius",
      }),
      row({ name: "Čili Pica", brand: null, locality: "Kaunas" }),
      row({ name: "Cili Pica", brand: null, locality: "Klaipėda" }),
    ],
    LT,
  );
  assertEquals(chainsOf(lt, "cili-pizza-lietuva").length, 3);
});

Deno.test("nameFitsBrand: only a same-kind or look-alike name contradicts the brand", () => {
  assertEquals(nameFitsBrand("Pizza Dominium", "Domino's Pizza"), false);
  assertEquals(nameFitsBrand("Crazy Piramid Pizza", "Domino's Pizza"), false);
  assertEquals(nameFitsBrand("Domino Pizza Włoska", "Domino's Pizza"), false);
  assertEquals(nameFitsBrand("Pizza-Hit", "Pizza Hut"), false);
  assertEquals(
    nameFitsBrand("Domino's Pizza - Strovolos", "Domino's Pizza"),
    true,
  );
  assertEquals(nameFitsBrand("Coffeeisland Paralimni", "Coffee Island"), true);
  assertEquals(nameFitsBrand("Bonarka City Center", "Costa Coffee"), true);
  assertEquals(
    nameFitsBrand("Минск, Рафиева, 64", "Domino's Pizza Беларусь"),
    true,
  );
  assertEquals(nameFitsBrand(null, "Domino's Pizza"), true);
});

Deno.test("tokens/clusterName: acute-accent apostrophe «Roma´s» is not split into «roma» + «s»", () => {
  assertEquals(tokens("Tony Roma´s"), tokens("Tony Roma's"));
  assertEquals(
    clusterName(["Tony Roma's", "Tony Roma´s Canovas"], [20, 1]),
    "Tony Roma's",
  );
});

Deno.test("inRing: point inside / outside a ring", () => {
  const ring: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assertEquals(inRing(2, 2, ring), true);
  assertEquals(inRing(5, 2, ring), false);
  assertEquals(inRing(2, -1, ring), false);
});

Deno.test("fast food only (10.11): discovery skips coffee, bakery, asian and plain restaurants, keeps fast food, has no cap, hand config stays", () => {
  const venue = (brand: string, category: string) =>
    [0, 1, 2].map((k) =>
      row({ name: brand, brand, category, locality: `City${k}` })
    );
  const rows = [
    ...venue("Pizza Hut Express", "pizza_restaurant"),
    ...venue("Burger Hub", "burger_restaurant"),
    ...venue("Kebab Palace", "restaurant"),
    ...venue("Local QSR", "fast_food_restaurant"),
    ...venue("Cafe Aroma", "cafe"),
    ...venue("Bakery Gold", "bakery"),
    ...venue("Sushi Wok House", "restaurant"),
    ...venue("Trattoria Roma", "restaurant"),
    ...venue("Zorba", "restaurant"),
    ...Array.from({ length: 50 }, (_, i) => venue(`Burger Num${i}x`, "burger_restaurant")).flat(),
  ];
  const r = discover(rows, { ...PL, chains: [] });
  const names = r.chains.map((c) => c.name);
  for (const keep of ["Pizza Hut Express", "Burger Hub", "Kebab Palace", "Local QSR"]) {
    assertEquals(names.includes(keep), true, keep);
  }
  for (const drop of ["Cafe Aroma", "Bakery Gold", "Sushi Wok House", "Trattoria Roma", "Zorba"]) {
    assertEquals(names.includes(drop), false, drop);
  }
  assertEquals(r.chains.length, 54);
  // Сеть из конфига страны (например Costa, сегмент coffee) остаётся при любом сегменте.
  const costa = discover(
    venue("Costa Coffee", "coffee_shop"),
    PL,
  );
  assertEquals(costa.points.length > 0 && costa.chains.length === 0, true);
});
