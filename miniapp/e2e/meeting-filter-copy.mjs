// Actual component/primitive/useDt SSR with synthetic entries; no server or API.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const app = fileURLToPath(new URL("../", import.meta.url));
const native = createRequire(path.join(app, "package.json"));
const ts = native("typescript"), React = native("react");
const { renderToStaticMarkup } = native("react-dom/server");
const screen = path.join(app, "src/components/roy/screens");
const cache = new Map();
let captures = [];
const jsx = native("react/jsx-runtime");
const runtime = Object.fromEntries(Object.entries(jsx).map(([key, value]) => [key,
  typeof value === "function" ? (...args) => {
    const element = value(...args);
    if (["button", "input"].includes(element.type)) captures.push(element);
    return element;
  } : value,
]));
function selected(filename, source, names) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter((n) =>
    ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) :
    ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => names.includes(d.name.getText(ast)))
  ).map((n) => n.getText(ast)).join("\n");
}
function resolve(specifier, from) {
  const base = specifier.startsWith("@/") ? path.join(app, "src", specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const p of [base, `${base}.ts`, `${base}.tsx`]) if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  throw new Error("fixture_module_resolution_failed");
}
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  let source = fs.readFileSync(filename, "utf8");
  if (filename.endsWith("/MeetAdminScreen.tsx")) {
    source = `import { useDt } from '../nav';
import { countryCode } from '@/lib/countries';
import { meetingSourceKey, sourceKeyLabel } from '@/lib/sourceLabels';
import { FilterChip, FilterGroup } from './meetAdminPresentation';
import { EMPTY_FILTERS, isFilterActive, personOf } from './meetingsFilter';\n` +
      selected(filename, source, ["PERIODS", "MeetingsFilters"]) + "\nexport { MeetingsFilters };";
  } else if (filename.endsWith("/meetAdminPresentation.tsx")) {
    source = "import { SectionLabel } from '../ui';\n" + selected(filename, source, ["FilterChip", "FilterGroup"]);
  } else if (filename.endsWith("/ui.tsx")) {
    source = "import { cn } from '@/lib/utils';\n" + selected(filename, source, ["SectionLabel"]);
  } else if (filename.endsWith("/entry.ts")) {
    source = selected(filename, source, ["entryImporterName", "SYSTEM_ADDED_BY", "isRawId"]);
  }
  const module = { exports: {} };
  const requireLocal = (specifier) => specifier === "react/jsx-runtime" ? runtime :
    specifier.startsWith(".") || specifier.startsWith("@/") ? load(resolve(specifier, filename)) : native(specifier);
  const javascript = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(javascript, { module, exports: module.exports, require: requireLocal, process: { env: {} }, console }, { filename, timeout: 2000 });
  cache.set(filename, module.exports);
  return module.exports;
}
const componentFile = fs.existsSync(path.join(screen, "MeetingsFilters.tsx")) ? path.join(screen, "MeetingsFilters.tsx") : path.join(screen, "MeetAdminScreen.tsx");
const { MeetingsFilters } = load(componentFile);
const { entryMeetingFacets } = load(path.join(app, "src/lib/meetingsFacets.ts"));
const { EMPTY_FILTERS } = load(path.join(app, "src/lib/meetingsFilters.ts"));
const { RoyNavContext } = load(path.join(app, "src/components/roy/nav.ts"));
const data = [
  { id: "fixture-a", source: "granola", countries: ["rs"], importer_name: "Ada" },
  { id: "fixture-b", source: "read_ai", countries: ["RS", "HU"], importer_name: "Bo" },
  { id: "fixture-c", source: "granola", countries: [], importer_name: "Ada" },
];
const active = { ...EMPTY_FILTERS, query: "fixture", period: "custom", from: "2026-01-02", to: "2026-03-04", countries: ["RS"], sources: ["granola"], people: ["Ada"], storage: "personal", status: "pending" };
const copy = {
  ru: { periods: ["Всё время", "Неделя", "Месяц", "Квартал", "Свой"], headings: ["Период", "Страны", "Источник", "Кто добавил", "Хранилище", "Статус"], storage: ["Любое", "Общее", "Личное"], statuses: ["Любой", "Согласовано", "На согласовании"], total: "Всего: 3", found: "Найдено: 2 из 3", reset: "Сбросить", search: "Поиск по названию…" },
  en: { periods: ["All time", "Week", "Month", "Quarter", "Custom"], headings: ["Period", "Countries", "Source", "Added by", "Storage", "Status"], storage: ["Any", "Shared", "Personal"], statuses: ["Any", "Confirmed", "Pending review"], total: "Total: 3", found: "Found: 2 of 3", reset: "Reset", search: "Search by title…" },
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const textOf = (v) => v == null || typeof v === "boolean" ? "" : typeof v === "object" ? Array.isArray(v) ? v.map(textOf).join("") : textOf(v.props?.children) : String(v);
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const failures = [], cases = [];
for (const lang of ["ru", "en"]) for (const mode of ["empty", "active", "single"]) {
  const c = copy[lang], value = mode === "active" ? active : EMPTY_FILTERS;
  const entries = mode === "single" ? data.slice(0, 1) : data;
  const changes = [];
  captures = [];
  const html = renderToStaticMarkup(React.createElement(RoyNavContext.Provider, { value: { me: { is_demo: lang === "en" } } },
    React.createElement(MeetingsFilters, { facets: entryMeetingFacets(entries), shown: mode === "active" ? 2 : entries.length, markets: mode === "active" ? ["RS"] : null, value, onChange: (next) => changes.push(plain(next)) })));
  const controls = [...captures];
  const check = (name, fn) => { try { fn(); } catch { failures.push(`${lang}/${mode}/${name}`); } };
  const buttons = controls.filter((e) => e.type === "button");
  const click = (label, field, next) => {
    const b = buttons.find((e) => textOf(e) === label);
    assert.ok(b); b.props.onClick();
    assert.deepEqual(changes.at(-1), plain({ ...value, [field]: next }));
  };
  check("static-copy", () => {
    for (const label of [...c.periods, c.headings[0], c.headings[1], ...c.headings.slice(4), ...c.storage, ...c.statuses]) assert.ok(html.includes(label));
    if (lang === "en") assert.ok(!/\p{Script=Cyrillic}/u.test(html));
    assert.ok(html.includes(mode === "active" ? c.found : mode === "single" ? c.total.replace("3", "1") : c.total));
    assert.equal(controls.find((e) => e.type === "input").props.placeholder, c.search);
    assert.equal(buttons.some((e) => textOf(e) === c.reset), mode === "active");
  });
  check("hidden-single-groups", () => {
    for (const heading of c.headings.slice(2, 4)) assert.equal(html.includes(heading), mode !== "single");
  });
  check("query", () => { controls.find((e) => e.type === "input").props.onChange({ target: { value: "next" } }); assert.deepEqual(changes.at(-1), plain({ ...value, query: "next" })); });
  check("period-ids", () => c.periods.forEach((label, i) => click(label, "period", ["all", "week", "month", "quarter", "custom"][i])));
  check("countries", () => { click(`RS${mode === "single" ? 1 : 2}`, "countries", mode === "active" ? [] : ["RS"]); assert.equal(buttons.some((e) => textOf(e) === "HU1"), mode === "empty"); });
  if (mode !== "single") {
    check("source-keys", () => { click("Granola2", "sources", mode === "active" ? [] : ["granola"]); click("Read.ai1", "sources", mode === "active" ? ["granola", "read_ai"] : ["read_ai"]); });
    check("people", () => { click("Ada2", "people", mode === "active" ? [] : ["Ada"]); click("Bo1", "people", mode === "active" ? ["Ada", "Bo"] : ["Bo"]); });
  }
  check("storage-ids", () => c.storage.forEach((label, i) => {
    // Both groups use 'Any' in EN; select by stable display order, not duplicate text.
    const b = buttons.slice(-6, -3)[i]; assert.equal(textOf(b), label); b.props.onClick();
    assert.deepEqual(changes.at(-1), plain({ ...value, storage: ["any", "shared", "personal"][i] }));
  }));
  check("status-ids", () => c.statuses.forEach((label, i) => {
    const b = buttons.slice(-3)[i]; assert.equal(textOf(b), label); b.props.onClick();
    assert.deepEqual(changes.at(-1), plain({ ...value, status: ["any", "confirmed", "pending"][i] }));
  }));
  if (mode === "active") {
    check("custom-dates", () => controls.filter((e) => e.props.type === "date").forEach((e, i) => {
      assert.equal(e.props.value, i === 0 ? value.from : value.to); e.props.onChange({ target: { value: "2026-05-06" } });
      assert.deepEqual(changes.at(-1), plain({ ...value, [i === 0 ? "from" : "to"]: "2026-05-06" }));
    }));
    check("reset", () => { buttons.find((e) => textOf(e) === c.reset).props.onClick(); assert.deepEqual(changes.at(-1), plain(EMPTY_FILTERS)); });
  }
  cases.push({ lang, mode, markup_sha256: hash(html), callbacks_sha256: hash(JSON.stringify(changes)), callback_count: changes.length });
}
console.log(JSON.stringify({ cases, failures, failed: failures.length, passed: 6 - new Set(failures.map((x) => x.split("/").slice(0, 2).join("/"))).size }));
if (failures.length) process.exitCode = 1;
