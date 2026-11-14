import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("manual merge review preserves RU/EN actions, literal titles, original note clocks/authors and legacy HTML", async () => {
  const result = await new Deno.Command("node", {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    args: ["miniapp/e2e/manual-merge-question.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const report = JSON.parse(new TextDecoder().decode(result.stdout));
  assertEquals([
    report.passed,
    report.notesPassed,
    report.readOnlyPassed,
    report.failed,
  ], [8, 6, 2, 0]);
});
