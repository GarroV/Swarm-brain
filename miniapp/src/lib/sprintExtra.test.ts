import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("sprint extras remain visible with an empty starting plan", async () => {
  const result = await new Deno.Command("node", {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    args: ["miniapp/e2e/sprint-extra.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const report = JSON.parse(new TextDecoder().decode(result.stdout));
  assertEquals(report.passed, 10);
  assertEquals(report.API, 0);
});
