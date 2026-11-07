import { assert, assertEquals, assertMatch } from "@std/assert";
import type { IngestPayload } from "../../../supabase/functions/market-ingest/types.ts";
import { EE } from "../countries/EE.ts";
import type { CountryConfig } from "../countries/types.ts";
import { eeAriregister } from "./ee-ariregister.ts";

const SITE = "https://avaandmed.ariregister.rik.ee";
const PAGE = `${SITE}/en/downloading-open-data`;
const REPORTS = `${SITE}/1.aruannete_yldandmed.zip`;
const ELEMENTS = (year: number) => `${SITE}/4.${year}_aruannete_elemendid.zip`;
const opts = { today: "2026-11-07" };
const reportCsv = (await Deno.readTextFile(
  new URL("../fixtures/ee-reports.csv", import.meta.url),
))
  .replaceAll(";111;", `;${EE.companies[0].regId};`);
const elementLines = (await Deno.readTextFile(
  new URL("../fixtures/ee-elements.csv", import.meta.url),
))
  .trim().split("\n");
const foreignCsv = reportCsv.split("\n").filter((line, i) =>
  i === 0 || line.split(";")[2] === "999"
).join("\n");
const annualCsv = (year: number) =>
  elementLines.filter((line, i) =>
    i === 0 ||
    (year === 2024
      ? line.startsWith("10;")
      : year === 2025 && /^(11|12|13);/.test(line))
  ).join("\n");

// One stored CSV entry: exercise the adapter's real download/tempfile/unzip path,
// with no additional archive dependency or external network.
function zip(csv: string): ArrayBuffer {
  const name = new TextEncoder().encode("fixture.csv"),
    data = new TextEncoder().encode(csv);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = new Uint8Array(30 + name.length + data.length),
    l = new DataView(local.buffer);
  l.setUint32(0, 0x04034b50, true);
  l.setUint16(4, 20, true);
  l.setUint32(14, crc, true);
  l.setUint32(18, data.length, true);
  l.setUint32(22, data.length, true);
  l.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(data, 30 + name.length);
  const central = new Uint8Array(46 + name.length),
    c = new DataView(central.buffer);
  c.setUint32(0, 0x02014b50, true);
  c.setUint16(4, 20, true);
  c.setUint16(6, 20, true);
  c.setUint32(16, crc, true);
  c.setUint32(20, data.length, true);
  c.setUint32(24, data.length, true);
  c.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, 1, true);
  e.setUint16(10, 1, true);
  e.setUint32(12, central.length, true);
  e.setUint32(16, local.length, true);
  const result = new Uint8Array(local.length + central.length + end.length);
  result.set(local);
  result.set(central, local.length);
  result.set(end, local.length + central.length);
  return result.buffer;
}

function page(years: number[], reports = true): string {
  return (reports ? `<a href="${REPORTS}">Reports</a>` : "") +
    years.map((y) => `<a href="${ELEMENTS(y)}">${y}</a>`).join("");
}

async function collectFixture({
  years = [2024, 2025],
  index = reportCsv,
  cfg = EE,
  failedUrl,
  includeReports = true,
}: {
  years?: number[];
  index?: string;
  cfg?: CountryConfig;
  failedUrl?: string;
  includeReports?: boolean;
} = {}) {
  const original = globalThis.fetch,
    requested: string[] = [],
    unexpected: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    if (url === failedUrl) {
      return Promise.resolve(new Response("", { status: 500 }));
    }
    if (url === PAGE) {
      return Promise.resolve(new Response(page(years, includeReports)));
    }
    if (url === REPORTS) return Promise.resolve(new Response(zip(index)));
    const year = years.find((y) => url === ELEMENTS(y));
    if (year !== undefined) {
      return Promise.resolve(new Response(zip(annualCsv(year))));
    }
    unexpected.push(url);
    return Promise.reject(new Error("Unexpected fixture URL"));
  };
  try {
    const result = await eeAriregister.collect(cfg, opts);
    assertEquals(unexpected, [], "All requests must use local fixtures");
    return { result, requested };
  } finally {
    globalThis.fetch = original;
  }
}

function failure(result: IngestPayload, message?: string): string {
  assert("failed" in result, message);
  assertEquals("years" in result, false);
  return result.failed;
}

function registryYears(result: IngestPayload) {
  assert("years" in result);
  assertEquals("failed" in result, false);
  return result.years;
}

Deno.test("EE collect: matched configured filings without any annual archive links fail", async () => {
  const { result, requested } = await collectFixture({ years: [] });
  const reason = failure(
    result,
    "Known configured filings and zero annual sources must not become successful years=[]",
  );
  assertMatch(reason, /matched_reports=2/);
  assertMatch(reason, /annual_archives=0/);
  assertEquals(requested, [PAGE, REPORTS]);
});

Deno.test("EE collect: foreign-only report index and no archives remain legitimately empty", async () => {
  const { result } = await collectFixture({ years: [], index: foreignCsv });
  assertEquals("failed" in result, false);
  assertEquals(registryYears(result), []);
});

Deno.test("EE collect: empty company configuration and no archives remain legitimately empty", async () => {
  const { result } = await collectFixture({
    years: [],
    cfg: { ...EE, companies: [] },
  });
  assertEquals("failed" in result, false);
  assertEquals(registryYears(result), []);
});

Deno.test("EE collect: existing latest-filing and three-archive selection retain financial rows", async () => {
  const { result, requested } = await collectFixture({
    years: [2022, 2023, 2024, 2025],
  });
  assertEquals("failed" in result, false);
  assertEquals(
    registryYears(result).map((
      { reg_id, year, revenue_eur, net_profit_eur, employees },
    ) => ({ reg_id, year, revenue_eur, net_profit_eur, employees })),
    [
      {
        reg_id: EE.companies[0].regId,
        year: 2025,
        revenue_eur: 1000,
        net_profit_eur: -50,
        employees: 7.5,
      },
      {
        reg_id: EE.companies[0].regId,
        year: 2024,
        revenue_eur: 800,
        net_profit_eur: null,
        employees: null,
      },
    ],
  );
  assertEquals(requested, [
    PAGE,
    REPORTS,
    ELEMENTS(2025),
    ELEMENTS(2024),
    ELEMENTS(2023),
  ]);
});

Deno.test("EE collect: an available older annual archive remains a successful partial result", async () => {
  const { result } = await collectFixture({ years: [2024] });
  assertEquals("failed" in result, false);
  assertEquals(registryYears(result).length, 1);
  assertEquals(registryYears(result)[0].year, 2024);
  assertEquals(registryYears(result)[0].revenue_eur, 800);
});

Deno.test("EE collect: missing reports-index link remains a failure", async () => {
  const { result, requested } = await collectFixture({ includeReports: false });
  assert(failure(result));
  assertEquals(requested, [PAGE]);
});

for (const failedUrl of [REPORTS, ELEMENTS(2025)]) {
  Deno.test(`EE collect: existing fetch failure propagates for ${failedUrl === REPORTS ? "reports" : "annual archive"}`, async () => {
    const { result } = await collectFixture({ failedUrl });
    assert(failure(result));
    assertEquals("years" in result, false);
  });
}
