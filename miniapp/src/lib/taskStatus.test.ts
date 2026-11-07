import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

// Compile and execute the real TSX controller in Node. Deno coverage must not
// measure a second copy of the TypeScript compiler; all APIs/children are fixtures.
Deno.test("TaskDetail: optimistic status operations roll back only the current loaded card", async () => {
  const output = await new Deno.Command("node", {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    args: ["miniapp/e2e/task-status.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, report || "Controller fixture failed");
  const parsed = JSON.parse(report);
  assertEquals(parsed.passed, 17);
  assertEquals(parsed.failed, 0);
  assertEquals(parsed.network, 0);
  assertEquals(parsed.externalWrites, 0);
  assertEquals(parsed.models, 0);
});
