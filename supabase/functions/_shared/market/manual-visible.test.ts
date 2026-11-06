import { assert } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setBlock, setPrice } from "./manual.ts";

Deno.test("#1132: hidden block data is refused before a database query", async () => {
  const sb = {
    from: () => {
      throw new Error("Invalid block reached the database");
    },
  } as unknown as SupabaseClient;
  const result = await setBlock(
    sb,
    "QM",
    "events",
    [{ date: "2026", kind: "close", text: "hidden" }],
    "https://example.org/report",
  );
  assert(!result.ok && result.error.includes("events[0]"), JSON.stringify(result));
});

Deno.test("#1132: unsupported or absent pizza type is refused before any query or conversion", async () => {
  const sb = {
    from: () => {
      throw new Error("Invalid price reached the database");
    },
  } as unknown as SupabaseClient;
  const fx = () => {
    throw new Error("Invalid price reached FX conversion");
  };
  for (const item_type of [undefined, "", "pizza", "classic", "signature"]) {
    const result = await setPrice(sb, "QM", {
      chain: "example",
      item: "Example",
      price: 10,
      currency: "MDL",
      source: "https://example.org/menu",
      item_type,
    }, fx);
    assert(!result.ok && result.error.includes("item_type"), JSON.stringify(result));
  }
});
