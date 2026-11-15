import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

// Native build, not a URL-parser mock. Only Google CSS is mocked; Next fetches
// the pinned public WOFF2 URL. No server, application API or model is started.
Deno.test("Next builds a valid extensionless font URL containing ampersands", async () => {
  const output = await new Deno.Command("node", {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    args: ["miniapp/e2e/font-url-build.fixture.mjs"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = new TextDecoder().decode(output.stdout);
  assertEquals(
    output.code,
    0,
    report || new TextDecoder().decode(output.stderr),
  );
  const parsed = JSON.parse(report);
  console.log(report.trim());
  assertEquals(parsed.status, "PASS");
  assertEquals(parsed.nextExit, 0);
  assertEquals(parsed.fontBytes, 24448);
  assertEquals(
    parsed.fontSha256,
    "ee24769e596b7905ff88986ccb47867bc20c200a733e014ecde909f45f7b16b2",
  );
  assertEquals(parsed.htmlUsesFont, true);
  assertEquals(parsed.cssUsesFont, true);
  assertEquals(parsed.fixtureCleaned, true);
});
