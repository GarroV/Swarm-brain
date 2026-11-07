import { assert, assertEquals, assertMatch } from "@std/assert";
import { RO } from "../countries/RO.ts";
import { roDatagov } from "./ro-datagov.ts";

const ecb = JSON.parse(
  Deno.readTextFileSync(new URL("../fixtures/ecb-ron.json", import.meta.url)),
);
const rows = Deno.readTextFileSync(
  new URL("../fixtures/ro-operators-2025.txt", import.meta.url),
);
const YEARS = [2025, 2024, 2023];

type Fixture = {
  available?: number[];
  missingFx?: boolean;
  emptyRows?: boolean;
  emptyCompanies?: boolean;
};
async function collectFixture(options: Fixture = {}) {
  const original = globalThis.fetch;
  const packages: string[] = [],
    downloads: string[] = [],
    unexpected: string[] = [];
  const rates = structuredClone(ecb);
  if (options.missingFx) {
    rates.dataSets[0].series["0:0:0:0:0"].observations = {};
  }
  globalThis.fetch = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "data-api.ecb.europa.eu") {
      return Promise.resolve(Response.json(rates));
    }
    if (
      url.hostname === "data.gov.ro" && url.pathname.endsWith("/package_show")
    ) {
      const name = url.searchParams.get("id") ?? "";
      packages.push(name);
      const year = Number(name.match(/(\d{4})$/)?.[1]);
      if (!(options.available ?? YEARS).includes(year)) {
        return Promise.resolve(
          Response.json({ error: "Package not published" }, { status: 404 }),
        );
      }
      return Promise.resolve(Response.json({
        result: {
          resources: ["BL_BS_SL", "IR"].map((form) => ({
            name: `WEB_${form}_AN${year}.TXT`,
            url: `https://data.gov.ro/fixture/WEB_${form}_AN${year}.TXT`,
          })),
        },
      }));
    }
    if (
      url.hostname === "data.gov.ro" && url.pathname.startsWith("/fixture/")
    ) {
      downloads.push(url.pathname);
      const selected = rows.split("\n").filter((line) =>
        url.pathname.includes("BL_BS_SL")
          ? line.startsWith("6645790,") || line.startsWith("6331682,")
          : line.startsWith("37586457,")
      ).join("\n");
      return Promise.resolve(new Response(options.emptyRows ? "" : selected));
    }
    unexpected.push(url.hostname);
    return Promise.reject(new Error("Unexpected fixture request"));
  };
  try {
    const result = await roDatagov.collect(
      options.emptyCompanies ? { ...RO, companies: [] } : RO,
      { today: "2026-11-07" },
    );
    assertEquals(unexpected, []);
    return { result, packages, downloads };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("RO collect: all three packages unavailable fails instead of successful empty years", async () => {
  const { result, packages, downloads } = await collectFixture({
    available: [],
  });
  assertEquals(
    packages,
    YEARS.flatMap((
      y,
    ) => [`situatii_financiare_${y}`, `situatii_financiare${y}`]),
  );
  assertEquals(downloads, []);
  assert(
    "failed" in result,
    "Configured companies with no annual reports must fail",
  );
  assertMatch(result.failed, /reports|reporting/i);
  assertEquals("years" in result, false);
});

Deno.test("RO collect: all annual FX rates missing fails instead of successful empty years", async () => {
  const { result, packages, downloads } = await collectFixture({
    missingFx: true,
  });
  assertEquals(packages.length, 3);
  assertEquals(downloads, []);
  assert(
    "failed" in result,
    "Missing every annual FX rate must not look like a successful collection",
  );
  assertMatch(result.failed, /ECB|FX|rates/i);
  assertEquals("years" in result, false);
});

Deno.test("RO collect: available reports without a configured company row fail", async () => {
  const { result, downloads } = await collectFixture({ emptyRows: true });
  assertEquals(downloads.length, 6);
  assert(
    "failed" in result,
    "An empty report stream must not look like collected financials",
  );
  assertEquals("years" in result, false);
});

Deno.test("RO collect: nonempty reporting keeps the configured operating companies", async () => {
  const { result, downloads } = await collectFixture();
  assertEquals("failed" in result, false);
  assert("years" in result);
  assertEquals(downloads.length, 6);
  assertEquals(result.years.length, 9);
  const kfc = result.years.find((y) =>
    y.year === 2025 && y.reg_id === "6645790"
  );
  assertEquals(
    kfc?.revenue_eur,
    Math.round(1133473526 / 5.0423901960784 * 100) / 100,
  );
  assertEquals(kfc?.employees, 3071);
  const pizzaHut = result.years.find((y) =>
    y.year === 2025 && y.reg_id === "6331682"
  );
  assertEquals(
    pizzaHut?.revenue_eur,
    Math.round(106788244 / 5.0423901960784 * 100) / 100,
  );
  assertEquals(pizzaHut?.employees, 385);
  for (const year of YEARS) {
    assertEquals(
      result.years.filter((y) => y.year === year).map((y) => y.reg_id).sort(),
      ["37586457", "6331682", "6645790"],
    );
  }
});

Deno.test("RO collect: unpublished latest year remains skippable when older years succeed", async () => {
  const { result, packages, downloads } = await collectFixture({
    available: [2024, 2023],
  });
  assertEquals("failed" in result, false);
  assert("years" in result);
  assertEquals(packages.slice(0, 2), [
    "situatii_financiare_2025",
    "situatii_financiare2025",
  ]);
  assertEquals(downloads.length, 4);
  assertEquals(result.years.length, 6);
  assertEquals([...new Set(result.years.map((y) => y.year))], [2024, 2023]);
});

Deno.test("RO collect: empty company configuration keeps the legitimate empty result", async () => {
  const { result } = await collectFixture({
    emptyCompanies: true,
    available: [],
  });
  assertEquals("failed" in result, false);
  assert("years" in result);
  assertEquals(result.years, []);
});
