import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const app = fileURLToPath(new URL("../", import.meta.url));
const ts = createRequire(app + "package.json")("typescript");
const source = fs.readFileSync(
  process.env.MARKET_READY_SOURCE ??
    (app + "src/components/market/MarketScreen.tsx"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const cacheSource = fs.readFileSync(app + "src/lib/request-cache.ts", "utf8");
const cacheModule = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(cacheSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  { module: cacheModule, exports: cacheModule.exports },
);

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function mount() {
  const values = [], effects = new Map(), readyRequests = [];
  const cache = cacheModule.exports.createRequestCache({
    ttlMs: 2500,
    now: () => 0,
  });
  let cursor = 0, tree, pending = [], countryGets = 0;
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const modules = {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!(i in values)) {
          values[i] = typeof initial === "function" ? initial() : initial;
        }
        return [values[i], (value) => {
          values[i] = typeof value === "function" ? value(values[i]) : value;
        }];
      },
      useMemo(fn) {
        cursor++;
        return fn();
      },
      useCallback(fn) {
        cursor++;
        return fn;
      },
      useEffect(callback, deps) {
        const i = cursor++, previous = effects.get(i);
        if (previous && deps.every((d, k) => Object.is(d, previous.deps[k]))) {
          return;
        }
        pending.push(() => {
          previous?.cleanup?.();
          effects.set(i, { deps, cleanup: callback() });
        });
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "@/lib/api": {
      fetchMarketCountries: async () => ["XD", "ZZ"],
      fetchMarketReady() {
        return cache.run("/market/ready", () => {
          const d = deferred();
          readyRequests.push(d);
          return d.promise;
        });
      },
      fetchMarket: async () => {
        countryGets++;
        return { country: "XD", editorial: {}, locations: [], chains: [] };
      },
    },
    "@/components/roy/nav": {
      useDt: () => (_ru, en) => en,
      useRoyNav: () => ({ me: { is_admin: true } }),
    },
    "@/lib/countries": { countryFlag: () => "", countryName: (code) => code },
    "@/lib/marketEditorial": {
      parseEditorial: () => ({ locationDates: [] }),
      applyLocationDates: (x) => x,
    },
    "@/lib/marketInsights": { dropDeadChains: (x) => x },
    "./fonts": { mktMono: { variable: "" }, mktSans: { variable: "" } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(specifier) {
      if (modules[specifier]) return modules[specifier];
      if (specifier.startsWith("./")) {
        return new Proxy({}, { get: (_o, name) => String(name) });
      }
      throw new Error("unexpected fixture module: " + specifier);
    },
    localStorage: { getItem: () => null, setItem() {} },
    console: { error() {}, warn() {} },
  });
  function render() {
    cursor = 0;
    tree = module.exports.MarketScreen();
    const run = pending;
    pending = [];
    run.forEach((fn) => fn());
  }
  async function settle() {
    for (let n = 0; n < 6; n++) {
      await Promise.resolve();
      render();
    }
  }
  function nodes(node, predicate) {
    if (!node || typeof node !== "object") return [];
    return [
      ...(predicate(node) ? [node] : []),
      ...[node.props?.children].flat(Infinity).flatMap((x) =>
        nodes(x, predicate)
      ),
    ];
  }
  return {
    render,
    settle,
    readyRequests,
    sourceChanged() {
      const freshness = nodes(tree, (n) => n.type === "Freshness")[0];
      assert.ok(
        freshness && typeof freshness.props.onChanged === "function",
        "actual sources view must expose its existing change handler",
      );
      // The real apiFetch invalidates this exact cache in finally after a mutation.
      // Freshness calls onChanged only after its import/accept request completes.
      cache.invalidate();
      freshness.props.onChanged();
    },
    marked() {
      const button =
        nodes(tree, (n) => n.type === "button" && n.key === "XD")[0];
      assert.ok(
        button,
        "actual country switcher must render the synthetic XD country",
      );
      return button.props.title !== undefined;
    },
  };
}

const cases = [];
for (const [latest, previous] of [[["XD"], []], [[], ["XD"]]]) {
  const app = mount();
  app.render();
  await app.settle();
  assert.equal(app.readyRequests.length, 1);
  app.sourceChanged();
  await app.settle();
  assert.equal(app.readyRequests.length, 2);
  app.readyRequests[1].resolve(latest);
  await app.settle();
  const beforeOld = app.marked();
  app.readyRequests[0].resolve(previous);
  await app.settle();
  const afterOld = app.marked();
  const passed = beforeOld === latest.includes("XD") && afterOld === beforeOld;
  cases.push({
    latestReady: latest.includes("XD"),
    beforeOld,
    afterOld,
    passed,
  });
}
const result = {
  sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
  cacheSourceSha256: crypto.createHash("sha256").update(cacheSource).digest(
    "hex",
  ),
  trigger:
    "existing source-change callback after real cache invalidation semantics",
  cases,
  passed: cases.filter((x) => x.passed).length,
  failed: cases.filter((x) => !x.passed).length,
  network: 0,
  writes: 0,
  models: 0,
};
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
