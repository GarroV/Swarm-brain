import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

// Run the actual controller and the actual request cache. HTTP and child views
// are fixtures; no server, backend write or model request is started.
Deno.test("Market readiness: only the current generation may update badges after a source change", async () => {
  const output = await new Deno.Command("node", {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    args: ["miniapp/e2e/market-ready-race.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, report || "Controller fixture failed");
  const parsed = JSON.parse(report);
  assertEquals(parsed.passed, 2);
  assertEquals(parsed.failed, 0);
  assertEquals(
    parsed.cases.every((
      c: { latestReady: boolean; beforeOld: boolean; afterOld: boolean },
    ) => c.latestReady === c.beforeOld && c.afterOld === c.beforeOld),
    true,
  );
});
