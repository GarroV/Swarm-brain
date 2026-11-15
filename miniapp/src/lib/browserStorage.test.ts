import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("browser storage namespaces preserve actual navigation and recent-query consumers", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = await new Deno.Command("node", {
    cwd: root,
    args: ["miniapp/e2e/browser-storage.fixture.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, report || "Storage consumer subprocess failed");
  const parsed = JSON.parse(report);
  assertEquals(parsed.passed, 18);
  assertEquals(parsed.failed, 0);
});
