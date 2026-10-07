// Шаблон отчёта держится в согласии с формой блоков: каждый блок ручной части есть ровно в
// одном разделе, и пример каждого блока проходит ту же проверку, что запись через MCP.
import { assertEquals } from "@std/assert";
import { EDITORIAL_BLOCKS, parseEditorial } from "./editorial.ts";
import { SECTIONS, templateText } from "./template.ts";

Deno.test("every editorial block is described in exactly one section of the template", () => {
  const seen = SECTIONS.flatMap((s) => Object.keys(s.blocks));
  assertEquals([...seen].sort(), Object.keys(EDITORIAL_BLOCKS).sort());
});

Deno.test("every template example is accepted by the block check", () => {
  for (const s of SECTIONS) {
    for (const [block, spec] of Object.entries(s.blocks)) {
      const errors: string[] = [];
      parseEditorial({ [block]: spec!.example }, errors);
      assertEquals(errors, [], `${s.id}.${block}`);
    }
  }
});

Deno.test("template text names every section and the tools to fill them", () => {
  const t = templateText();
  for (const s of SECTIONS) assertEquals(t.includes(`[${s.id}]`), true, s.id);
  for (const tool of ["market_set_block", "market_set_company_year", "market_upsert_location", "market_set_price"]) {
    assertEquals(t.includes(tool), true, tool);
  }
});
