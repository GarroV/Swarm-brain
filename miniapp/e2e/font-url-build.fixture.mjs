// Actual Next/Turbopack regression for extensionless Google font URLs with &.
// CSS is deterministic through Next's official test hook. The pinned public
// WOFF2 URL still uses the normal build-time fetch; this is not an offline test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const miniapp = fileURLToPath(new URL("../", import.meta.url));
const fontUrl =
  "https://fonts.gstatic.com/l/font?kit=UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA&skey=c491285d6722e4fa&v=v20";
const expectedFontSha =
  "ee24769e596b7905ff88986ccb47867bc20c200a733e014ecde909f45f7b16b2";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let fixture;
let stage = "prepare";
let build;
let result;

async function nativeBuild(cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(miniapp, "node_modules/next/dist/bin/next"),
      "build",
      "--turbopack",
    ], {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let overflow = false;
    const kill = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") reject(error);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, 120_000);
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 4 * 1024 * 1024) {
        overflow = true;
        kill();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, overflow, output });
    });
  });
}

try {
  const next = JSON.parse(
    await readFile(
      path.join(miniapp, "node_modules/next/package.json"),
      "utf8",
    ),
  );
  assert.equal(new URL(fontUrl).pathname, "/l/font");
  assert.equal(new URL(fontUrl).searchParams.size, 3);
  const scratch = path.join(miniapp, ".next");
  await mkdir(scratch, { recursive: true });
  fixture = await mkdtemp(path.join(scratch, "font-url-build-"));
  await mkdir(path.join(fixture, "app"));
  await symlink(
    path.join(miniapp, "node_modules"),
    path.join(fixture, "node_modules"),
    "junction",
  );
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "font-url-regression", private: true }),
  );
  await writeFile(
    path.join(fixture, "next.config.mjs"),
    `export default { output: 'export', experimental: { cpus: 1 }, turbopack: { root: ${
      JSON.stringify(miniapp)
    } } };\n`,
  );
  await writeFile(
    path.join(fixture, "app/layout.jsx"),
    `import { Inter } from 'next/font/google';
const inter = Inter({ weight: '400', subsets: ['latin'], display: 'swap', preload: false, adjustFontFallback: false });
export default function Layout({ children }) { return <html><body className={inter.className}>{children}</body></html>; }
`,
  );
  await writeFile(
    path.join(fixture, "app/page.jsx"),
    "export default function Page() { return <main>Font URL regression</main>; }\n",
  );
  const mockedCss =
    `/* latin */\n@font-face {\nfont-family: 'Inter';\nfont-style: normal;\nfont-weight: 400;\nfont-display: swap;\nsrc: url(${fontUrl}) format('woff2');\n}\n`;
  const mockFile = path.join(fixture, "mock-font-css.cjs");
  await writeFile(
    mockFile,
    `module.exports = ${
      JSON.stringify({
        "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap":
          mockedCss,
      })
    };\n`,
  );
  stage = "native-next-build";
  build = await nativeBuild(fixture, {
    ...process.env,
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    RAYON_NUM_THREADS: "2",
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: mockFile,
  });
  assert.equal(build.timedOut, false, "native build exceeded 120 seconds");
  assert.equal(build.overflow, false, "native build output exceeded limit");
  assert.equal(build.code, 0, "native Next build must succeed");
  stage = "emitted-font-css-html";
  const output = path.join(fixture, "out");
  const media = path.join(output, "_next/static/media");
  const fonts = (await readdir(media)).filter((file) =>
    file.endsWith(".woff2")
  );
  assert.equal(fonts.length, 1, "exactly one mocked font must be emitted");
  const font = await readFile(path.join(media, fonts[0]));
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
  assert.equal(font.length, 24448);
  assert.equal(
    sha(font),
    expectedFontSha,
    "emitted font must match the pinned valid WOFF2",
  );
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const stylesheetPaths = [
    ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(stylesheetPaths.length > 0, "HTML must load a stylesheet");
  const css = (await Promise.all(stylesheetPaths.map((file) =>
    readFile(path.join(output, file), "utf8")
  ))).join("\n");
  assert.ok(
    css.includes(fonts[0]),
    "HTML-loaded CSS must reference the emitted font",
  );
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*['"]?Inter\b/);
  assert.match(css, /font-weight:\s*400\b/);
  const bodyClass = html.match(/<body\b[^>]*class="([^"]+)"/)?.[1];
  assert.ok(bodyClass, "HTML body must use the generated font class");
  assert.ok(
    bodyClass.split(/\s+/).some((name) => {
      assert.match(name, /^[\w-]+$/);
      const declaration = css.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))
        ?.[1];
      return declaration && /font-family:\s*['"]?Inter\b/.test(declaration);
    }),
    "body class must use Inter in emitted CSS",
  );
  assert.ok(
    !css.includes("fonts.gstatic.com"),
    "font CSS must use the local emitted asset",
  );
  result = {
    status: "PASS",
    nextVersion: next.version,
    nextExit: build.code,
    fontBytes: font.length,
    fontSha256: sha(font),
    htmlUsesFont: true,
    cssUsesFont: true,
    cssMocked: true,
    fontFetch: "pinned-public-CDN",
    httpStand: false,
  };
} catch (error) {
  result = {
    status: "FAIL",
    stage,
    error: error.message,
    nextExit: build?.code,
    timedOut: build?.timedOut,
    importMapError: build?.output.includes(
      "next/font/google queries have exactly one entry",
    ) ?? false,
    buildLogTail: build?.output.slice(-6000),
  };
  process.exitCode = 1;
} finally {
  if (fixture) await rm(fixture, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...result, fixtureCleaned: !!fixture }));
