import { assertEquals } from "jsr:@std/assert@1";
import { renderSources } from "./sources-doc.ts";

Deno.test("docs/market/SOURCES.md matches the country configs (regenerate: deno run -A scripts/market/sources-doc.ts > docs/market/SOURCES.md)", async () => {
  const doc = await Deno.readTextFile(
    new URL("../../docs/market/SOURCES.md", import.meta.url),
  );
  assertEquals(doc, renderSources());
});
