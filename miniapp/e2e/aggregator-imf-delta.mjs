// Actual component SSR regression. Only the data hook is replaced with a synthetic
// API-shaped response; aggregation, Delta, Stat, useDt and ReactDOMServer are real.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const app = fileURLToPath(new URL("../", import.meta.url));
const native = createRequire(path.join(app, "package.json"));
const ts = native("typescript");
const React = native("react");
const { renderToStaticMarkup } = native("react-dom/server");
const home = path.join(app, "src/components/roy/home");
const cache = new Map();
let response;

function resolve(specifier, from) {
  const base = specifier.startsWith("@/")
    ? path.join(app, "src", specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error("fixture_module_resolution_failed");
}

function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  let source = fs.readFileSync(filename, "utf8");
  if (filename === path.join(home, "QualityWidgets.tsx")) {
    // Exact source bodies of the shared renderers, without unrelated chart hooks.
    const tree = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const selected = tree.statements.filter((node) =>
      (ts.isFunctionDeclaration(node) &&
        ["Delta", "Stat"].includes(node.name?.text)) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((d) =>
          d.name.getText(tree) === "card"
        ))
    );
    assert.equal(selected.length, 3);
    source = 'import { FILL_CARD } from "./blockFill";\n' +
      selected.map((node) => node.getText(tree)).join("\n");
  }
  const module = { exports: {} };
  const requireLocal = (specifier) => {
    if (
      filename === path.join(home, "AggregatorsTab.tsx") &&
      specifier === "./useAggregators"
    ) {
      return {
        useAggregators: () => ({
          data: response,
          loading: false,
          failed: false,
          retry: () => {},
        }),
      };
    }
    return specifier.startsWith(".") || specifier.startsWith("@/")
      ? load(resolve(specifier, filename))
      : native(specifier);
  };
  const javascript = ts.transpileModule(source, {
    fileName: filename.replace(/\.mjs$/, ".ts"),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(javascript, {
    module,
    exports: module.exports,
    require: requireLocal,
    process: { env: {} },
    console,
    setTimeout,
    clearTimeout,
  }, { filename, timeout: 2000 });
  cache.set(filename, module.exports);
  return module.exports;
}

const { RoyNavContext } = load(path.join(app, "src/components/roy/nav.ts"));
const { AggregatorsTab } = load(path.join(home, "AggregatorsTab.tsx"));
const { Delta } = load(path.join(home, "QualityWidgets.tsx"));
const { aggregatorTotals, deltaDigits } = load(
  path.join(app, "src/lib/homeAggregators.ts"),
);
const h = React.createElement;
const scenarios = [
  { name: "positive", mine: 0, other: 0.4, imf: 0.3 },
  { name: "negative", mine: 0.75, other: -0.65, imf: -0.3 },
  { name: "zero", mine: 0.75, other: -0.25, imf: 0 },
  { name: "null", mine: null, other: null, imf: null },
];
const averages = { 5: [3.5, 3.88], 10: [7, 7.75], 100: [70, 77.5] };
const results = [];

for (const scale of [5, 10, 100]) {
  for (const scenario of scenarios) {
    const score = (avg, delta, votes) => ({
      avg,
      delta,
      votes,
      scale,
      pizzerias: 1,
    });
    response = {
      on: "2026-11-07",
      compare: "2026-10-08",
      loaded_at: null,
      aggregators: [{ key: "synthetic", title: "Synthetic delivery", scale }],
      countries: [
        {
          cc: "RS",
          as_of: "2026-11-07",
          scores: { synthetic: score(averages[scale][0], scenario.mine, 1) },
        },
        {
          cc: "HR",
          as_of: "2026-11-07",
          scores: { synthetic: score(scale * 0.8, scenario.other, 3) },
        },
      ],
    };
    const mine = aggregatorTotals(response, ["RS"])[0];
    const imf = aggregatorTotals(response, ["RS", "HR"])[0];
    // Existing calculation is consumed unchanged; literal expected fixture metrics
    // catch accidental use of the selected-country delta in the IMF position.
    assert.equal(mine.avg, averages[scale][0]);
    assert.equal(imf.avg, averages[scale][1]);
    assert.equal(imf.delta, scenario.imf);
    for (const language of ["ru", "en"]) {
      for (const theme of ["light", "dark"]) {
        const result = {
          scale,
          scenario: scenario.name,
          language,
          theme,
          status: "FAIL",
        };
        try {
          const html = renderToStaticMarkup(
            h(
              RoyNavContext.Provider,
              { value: { me: { is_demo: language === "en" } } },
              h(
                "div",
                { className: theme === "dark" ? "dark" : "" },
                h(AggregatorsTab, { codes: ["RS"] }),
              ),
            ),
          );
          const notes = [
            ...html.matchAll(
              /<small\b[^>]*class="[^"]*text-ink-soft[^"]*"[^>]*>([\s\S]*?)<\/small>/g,
            ),
          ]
            .map((match) => match[1]).filter((note) => note.includes("IMF"));
          assert.equal(notes.length, 1);
          const expected = renderToStaticMarkup(
            h(Delta, {
              v: scenario.imf,
              digits: deltaDigits(scale),
              small: true,
            }),
          );
          if (scenario.imf === null) {
            assert(
              !notes[0].includes("▲") && !notes[0].includes("▼") &&
                !notes[0].includes("●"),
            );
          } else {
            assert(
              notes[0].includes(expected),
              "missing_or_wrong_IMF_delta_markup",
            );
          }
          const own = renderToStaticMarkup(
            h(Delta, {
              v: scenario.mine,
              digits: deltaDigits(scale),
              small: true,
            }),
          );
          if (own) assert(html.includes(own), "selected_country_delta_changed");
          result.status = "PASS";
        } catch {
          result.error_kind = "IMF_render_assertion_failed";
        }
        results.push(result);
      }
    }
  }
}
const failed = results.filter((result) => result.status !== "PASS");
console.log(JSON.stringify({
  status: failed.length ? "FAIL" : "PASS",
  renderer: "actual AggregatorsTab/Stat/Delta + ReactDOMServer",
  data: "synthetic API-shaped response; actual aggregatorTotals",
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}));
if (failed.length) process.exitCode = 1;
