import { assertEquals } from "@std/assert";
import { DecimusHttpError } from "../_shared/decimus.ts";
import { handlePerformanceRoutes, performanceQuery } from "./performance.ts";
import { handleAnalyticsRoutes } from "./analytics.ts";

Deno.test("performance bounds countries and validates real calendar dates", () => {
  assertEquals(performanceQuery(new URL("https://example.test/performance?countries=rs,BG,rs&as_of=2026-02-28")), {
    countries: "BG,RS",
    as_of: "2026-02-28",
  });
  for (
    const query of [
      "",
      "countries=RS,&as_of=2026-11-14",
      "countries=RS&as_of=2026-02-30",
      "countries=RS&as_of=tomorrow",
    ]
  ) {
    assertEquals(performanceQuery(new URL(`https://example.test/performance?${query}`)), null);
  }
});

Deno.test("performance proxies exact requested slice without recalculating source numbers", async () => {
  const request = new Request("https://example.test/performance?countries=rs&as_of=2026-11-14");
  const body = {
    as_of: "2026-11-14",
    countries: [{ cc: "RS", metrics: { revenue: { current: { value: "12345678" } } } }],
  };
  const response = await handlePerformanceRoutes(request, "/performance", false, "", (path, query) => {
    assertEquals(path, "/api/v1/performance");
    assertEquals(query, { countries: "RS", as_of: "2026-11-14" });
    return Promise.resolve(body);
  });
  assertEquals(response?.status, 200);
  assertEquals(await response?.json(), body);
});

Deno.test("performance demo never calls the real financial source", async () => {
  const response = await handlePerformanceRoutes(
    new Request("https://example.test/performance?countries=RS"),
    "/performance",
    true,
    "",
    () => {
      throw new Error("must not call source");
    },
  );
  assertEquals(response?.status, 200);
  assertEquals(await response?.json(), { as_of: null, countries: [] });
});

Deno.test("analytics dispatch keeps quality and performance demo routes", async () => {
  for (const [path, query] of [["/performance", "countries=RS"], ["/quality", "kind=rs"]]) {
    const response = await handleAnalyticsRoutes(new Request(`https://example.test${path}?${query}`), path, true, "");
    assertEquals(response?.status, 200);
  }
  assertEquals(
    await handleAnalyticsRoutes(new Request("https://example.test/unrelated"), "/unrelated", true, ""),
    null,
  );
});

Deno.test("performance rejects source country leakage and hides source error text", async () => {
  const request = new Request("https://example.test/performance?countries=RS");
  const wrong = await handlePerformanceRoutes(
    request,
    "/performance",
    false,
    "",
    () => Promise.resolve({ countries: [{ cc: "BG" }] }),
  );
  assertEquals(wrong?.status, 502);
  const denied = await handlePerformanceRoutes(
    request,
    "/performance",
    false,
    "",
    () => Promise.reject(new DecimusHttpError(403, "private_source_marker")),
  );
  assertEquals(denied?.status, 503);
  assertEquals((await denied!.text()).includes("private_source_marker"), false);
});
