// Генератор _headers для Cloudflare Pages: общие заголовки безопасности + CSP с хешами ВСЕХ
// inline-скриптов каждой страницы.
//
// Зачем генерировать, а не писать руками: статический экспорт Next кладёт в каждую страницу
// служебные inline-скрипты `self.__next_f.push(...)` с данными гидрации — их содержимое меняется
// от сборки к сборке и от страницы к странице. Захардкоженный хеш здесь жить не может, а
// 'unsafe-inline' обнулил бы главную защиту CSP. Поэтому: после сборки читаем out/**/*.html,
// считаем sha256 каждого inline-скрипта и пишем per-path блоки в out/_headers.
//
// Проверено вживую на превью Cloudflare: с одним лишь хешем скрипта темы браузер в
// Report-Only ругался «Executing inline script violates…» — именно из-за скриптов Next.
//
// Запуск: node scripts/gen-csp-headers.mjs  (подключён к `npm run build` после next build)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out");

// Адрес API прода: connect-src должен его пускать, иначе приложение не сможет говорить с бэкендом.
// Берём из сборочного окружения, с дефолтом на боевой проект (тот же, что в docs/ARCHITECTURE.md).
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  try {
    return raw.startsWith("http") ? new URL(raw).origin : "https://vbqglndbxkpmreccpqmr.supabase.co";
  } catch {
    return "https://vbqglndbxkpmreccpqmr.supabase.co";
  }
})();

// Демо-витрина встраивается iframe'ом на портфолио — frame-ancestors должен это пускать
// (X-Frame-Options списка доменов не умеет, поэтому его не используем).
const EMBEDDERS = ["'self'", "https://garrov.github.io"];

// Блокирующая политика включается переменной: CSP_ENFORCE=1. По умолчанию Report-Only —
// нарушения видны в консоли, но ничего не запрещается (issue #100: включать строгую политику
// сразу нельзя, статический экспорт ломается молча).
const HEADER_NAME = process.env.CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const COMMON = [
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy: same-origin-allow-popups",
];

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

/** sha256 каждого inline-скрипта страницы (по порядку, без дублей). */
function scriptHashes(html) {
  const hashes = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m[1];
    if (!body.trim()) continue;
    hashes.add("'sha256-" + createHash("sha256").update(body, "utf8").digest("base64") + "'");
  }
  return [...hashes];
}

/** Путь запроса, которому соответствует файл: out/login.html → /login, out/index.html → / */
function routeFor(file) {
  const rel = relative(outDir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"/index.html".length);
  return "/" + rel.replace(/\.html$/, "");
}

function csp(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    // style-src с 'unsafe-inline' осознанно: интерфейс широко использует style={{…}} (inline-
    // атрибуты), их хешировать нельзя. Скрипты при этом остаются под хешами — а именно они и
    // дают XSS-исполнение.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    `frame-ancestors ${EMBEDDERS.join(" ")}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

const files = htmlFiles(outDir);
if (files.length === 0) {
  console.error("❌ в out/ нет html — сначала next build");
  process.exit(1);
}

const lines = [
  "# СГЕНЕРИРОВАНО scripts/gen-csp-headers.mjs при сборке. Руками не править —",
  "# правки затрутся следующей сборкой; меняй генератор.",
  "#",
  `# Режим CSP: ${HEADER_NAME}${process.env.CSP_ENFORCE ? "" : "  (включить блокирующий: CSP_ENFORCE=1 npm run build)"}`,
  "",
  "/*",
  ...COMMON.map((h) => "  " + h),
  "",
];

for (const file of files.sort()) {
  const html = readFileSync(file, "utf8");
  const hashes = scriptHashes(html);
  const route = routeFor(file);
  lines.push(route === "/" ? "/" : route, `  ${HEADER_NAME}: ${csp(hashes)}`, "");
  console.log(`  ${route.padEnd(14)} inline-скриптов: ${hashes.length}`);
}

writeFileSync(join(outDir, "_headers"), lines.join("\n"), "utf8");
console.log(`✅ out/_headers: ${files.length} маршрут(ов), режим ${HEADER_NAME}`);
