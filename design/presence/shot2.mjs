// node shot2.mjs <width> <out.png> <scrollY> — снимок bestiary.html через chrome-headless-shell
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
const puppeteer = createRequire(homedir() + "/sb-smoke/")("puppeteer-core");
const exe = homedir() + "/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const [w, out, y] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: exe, headless: "shell", args: ["--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: +w, height: 900 });
  await p.goto("file://" + resolve("bestiary.html"), { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2000));
  const ok = await Promise.race([
    p.screenshot({ path: out, clip: { x: 0, y: +y || 0, width: +w, height: 900 } }).then(() => true),
    new Promise((r) => setTimeout(() => r(false), 25000)),
  ]);
  console.log(ok ? "ok " + out : "FAIL: снимок завис");
  if (!ok) process.exitCode = 1;
} finally { await b.close(); }
