import { assert, assertEquals, assertMatch } from "@std/assert";
import { decideYears, type Page } from "../bg-registry.ts";
import type { CountryConfig } from "../countries/types.ts";
import { bgRegistry, readCompany } from "./bg-registry.ts";

const EIK = "000000001";
const API = "https://portal.registryagency.bg/CR/api";
const cfg: CountryConfig = {
  country: "BG",
  dodoCode: "bg",
  chains: [],
  companies: [{ chain: null, name: "Synthetic company", regId: EIK }],
  sources: [],
};

type Fixture = {
  years?: number[];
  deedStatus?: number;
  emptyCompanies?: boolean;
  documentStatus?: Record<string, number>;
};

async function withTransport<T>(options: Fixture, read: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const requests: string[] = [], unexpected: string[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url === `${API}/Deeds/${EIK}`) {
      if (options.deedStatus) {
        return Promise.resolve(
          new Response("Fixture failure", { status: options.deedStatus }),
        );
      }
      const htmlData = (options.years ?? []).map((year) =>
        `<p>Годишен финансов отчет<br/>Година: ${year}г.<br/><a href='DocumentAccess/fixture-${year}'>report</a></p>`
      ).join("");
      return Promise.resolve(Response.json({ sections: [{ htmlData }] }));
    }
    if (url.startsWith(`${API}/Documents/fixture-`)) {
      const status = options.documentStatus?.[url.split("/").at(-1)!] ?? 404;
      return Promise.resolve(
        new Response(
          status === 200
            ? new Uint8Array([37, 80, 68, 70])
            : "PRIVATE_PROVIDER_BODY",
          { status },
        ),
      );
    }
    unexpected.push(url);
    return Promise.reject(new Error("Unexpected fixture request"));
  };
  console.warn = () => {};
  try {
    const result = await read();
    assertEquals(unexpected, []);
    return { result, requests };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

const collectFixture = (options: Fixture = {}) =>
  withTransport(options, () =>
    bgRegistry.collect(
      options.emptyCompanies ? { ...cfg, companies: [] } : cfg,
      { today: "2026-11-07" },
    ));

for (const years of [[2025], [2025, 2024]]) {
  Deno.test(`BG collect: all ${years.length} advertised document downloads fail`, async () => {
    const { result, requests } = await collectFixture({ years });
    assertEquals(requests.length, years.length + 1);
    assert(
      "failed" in result,
      "Every advertised document failed: the source must fail",
    );
    assertEquals("years" in result, false);
    assertMatch(result.failed, /document attempts failed/);
    assertEquals(result.failed.includes("PRIVATE_PROVIDER_BODY"), false);
  });
}

Deno.test("BG collect: no advertised filings preserves legitimate empty reporting", async () => {
  const { result, requests } = await collectFixture();
  assertEquals(requests.length, 1);
  assert("years" in result);
  assertEquals(result.years, []);
  assertEquals("failed" in result, false);
});

Deno.test("BG collect: empty company configuration remains a successful empty result", async () => {
  const { result, requests } = await collectFixture({ emptyCompanies: true });
  assertEquals(requests, []);
  assert("years" in result);
  assertEquals(result.years, []);
  assertEquals("failed" in result, false);
});

Deno.test("BG collect: deed transport errors already fail the source", async () => {
  const { result, requests } = await collectFixture({ deedStatus: 404 });
  assertEquals(requests.length, 1);
  assert("failed" in result);
  assertEquals("years" in result, false);
});

// Same synthetic statement shape as ../bg-registry.test.ts. The reader supplies Page[];
// this exercises the actual financial parser, not real PDF tools or OCR.
const incomePage = (ocr = false): Page => ({
  text: `ОТЧЕТ ЗА ПЕЧАЛБАТА И ЗАГУБАТА И ДРУГИЯ ВСЕОБХВАТЕН ДОХОД
на Тест ЕООД за годината, приключваща на 31 декември 2024 г.
в хил. лв.
бележка  на 31.12.2024  на 31.12.2023
Продължаващи дейности
Приходи от продажби 14 41 237 52 618
Себестойност на продажбите 15 (30 011) (39 022)
`,
  ocr,
});
const mixed: Fixture = {
  years: [2025, 2024],
  documentStatus: { "fixture-2024": 200 },
};

Deno.test("BG company: failed document does not discard a readable financial statement", async () => {
  let reads = 0;
  const { result, requests } = await withTransport(
    mixed,
    () =>
      readCompany(EIK, (pdf) => {
        reads++;
        assertEquals([...pdf], [37, 80, 68, 70]);
        return Promise.resolve([incomePage()]);
      }),
  );
  assertEquals(requests.length, 3);
  assertEquals(reads, 1);
  assertEquals(result.length, 1);
  assertEquals(result[0].year, 2024);
  assert(decideYears(result).some((year) => year.revenueBgn === 41_237_000));
});

Deno.test("BG company: completed non-income document is not an all-exception failure", async () => {
  const { result } = await withTransport(
    mixed,
    () =>
      readCompany(EIK, () =>
        Promise.resolve([{
          text: "Приложение без отчет за доходи",
          ocr: false,
        }])),
  );
  assertEquals(result, []);
});

Deno.test("BG company: unconfirmed OCR remains withheld rather than a source exception", async () => {
  const { result } = await withTransport(
    mixed,
    () => readCompany(EIK, () => Promise.resolve([incomePage(true)])),
  );
  assertEquals(result.length, 1);
  const years = decideYears(result);
  assert(years.length > 0);
  assert(years.every((year) => year.revenueBgn === null));
});
