import { readFileSync, writeFileSync, existsSync } from "node:fs";
const r = (f) => readFileSync(f, "utf8");
const parts = [1, 2, 3, 4, 5].map((n) => `glyphs/part-${n}.js`).filter(existsSync);
const desc = {};
for (const line of r("SPEC.md").split("\n")) {
  const m = line.match(/^(\d+) .+? — (.+)$/); if (m) desc[m[1]] = m[2];
}
const html = r("sheet.tpl.html")
  .replace("@AVATARS_CSS@", () => r("avatars.css"))
  .replace("@RENDER_JS@", () => r("render.js"))
  .replace("@GLYPHS_JS@", () => parts.map(r).join("\n"))
  .replace("@DESC@", () => JSON.stringify(desc));
writeFileSync("bestiary.html", html);
console.log("parts", parts.length, "bytes", html.length);
