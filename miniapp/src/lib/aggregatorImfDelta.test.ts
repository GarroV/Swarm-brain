import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

// Kept in the project's existing Deno suite. The Node subprocess supplies React's
// actual SSR runtime from the already installed miniapp lockfile; no server starts.
Deno.test("delivery-app IMF delta renders positive, negative, zero and null on all native scales", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = await new Deno.Command("node", {
    cwd: root,
    args: ["miniapp/e2e/aggregator-imf-delta.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, report || "SSR subprocess failed");
  const parsed = JSON.parse(report);
  assertEquals(parsed.passed, 48);
  assertEquals(parsed.failed, 0);
});
