import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("meeting filter copy follows locale while counts, stable IDs and reset payloads stay intact", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = await new Deno.Command("node", {
    cwd: root,
    args: ["miniapp/e2e/meeting-filter-copy.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, report || "Filter SSR subprocess failed");
  const parsed = JSON.parse(report);
  assertEquals(parsed.passed, 6);
  assertEquals(parsed.failed, 0);
});
