// node preview.mjs glyphs/part-1.js out.png — рисует часть в трёх стилях (крупно и 28px)
import { createRequire } from "node:module";
import { resolve } from "node:path";
const puppeteer = createRequire(process.env.HOME + "/sb-smoke/")("puppeteer-core");
const exe = process.env.HOME + "/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [part, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--disable-gpu","--use-angle=swiftshader","--enable-unsafe-swiftshader","--allow-file-access-from-files"] });
try {
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.setViewport({ width: 560, height: 400, deviceScaleFactor: 1 });
  await p.goto("file://" + resolve("preview.html") + "?part=" + resolve(part), { waitUntil: "load" });
  await p.waitForFunction(() => document.title === "ready", { timeout: 10000 });
  const h = await p.evaluate(() => document.body.scrollHeight);
  await p.setViewport({ width: 560, height: h + 12 });
  const shot = await Promise.race([p.screenshot({ path: out }).then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))]);
  if (!shot) { console.log("FAIL: снимок завис, PNG НЕ обновлён — перезапусти"); process.exitCode = 1; }
  if (errs.length) console.log("ERRORS:\n" + errs.join("\n")); else if (shot) console.log("ok", out);
} finally { await b.close(); }
