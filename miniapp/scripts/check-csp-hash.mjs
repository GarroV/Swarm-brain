// Сторож CSP: хеш inline-скрипта темы в public/_headers должен совпадать с самим скриптом
// в app/layout.tsx. Иначе политика молча запретит скрипт: страница останется, а тема перестанет
// следовать за системной — ровно тот класс поломки, который не видно на глаз в дев-режиме
// (в дев-сборке заголовков Cloudflare нет вообще).
//
// Запуск: node scripts/check-csp-hash.mjs  (в CI — шагом рядом с npm run build)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const headers = readFileSync(join(root, "public/_headers"), "utf8");

const m = layout.match(/const THEME_SCRIPT = `([\s\S]*?)`;/);
if (!m) {
  console.error("❌ не нашёл THEME_SCRIPT в src/app/layout.tsx — переименовали? тогда поправь и этот сторож");
  process.exit(1);
}
const expected = "sha256-" + createHash("sha256").update(m[1], "utf8").digest("base64");

const inHeaders = headers.match(/'(sha256-[A-Za-z0-9+/=]+)'/);
if (!inHeaders) {
  console.error("❌ в public/_headers нет хеша script-src 'sha256-…' — CSP запретит inline-скрипт темы");
  process.exit(1);
}

if (inHeaders[1] !== expected) {
  console.error("❌ хеш CSP разошёлся со скриптом темы");
  console.error("   в _headers:  " + inHeaders[1]);
  console.error("   надо:        " + expected);
  console.error("   Замени значение в public/_headers (script-src 'sha256-…').");
  process.exit(1);
}

console.log("✅ CSP: хеш inline-скрипта темы совпадает (" + expected.slice(0, 24) + "…)");
