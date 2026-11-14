// Actual production storage consumers with synthetic browser ports. No React mount/API/model.
// TypeScript runs in this Node child, outside the Deno coverage graph.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url));
const native = createRequire(path.join(app, "package.json"));
const ts = native("typescript");
const source = (rel) => fs.readFileSync(path.join(app, rel), "utf8");
const parsed = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const plain = (v) => JSON.parse(JSON.stringify(v));

class Store {
  constructor(initial = {}, blocked = false) {
    this.values = new Map(Object.entries(initial));
    this.calls = [];
    this.blocked = blocked;
  }
  getItem(key) {
    this.calls.push(["get", key]);
    if (this.blocked) throw new Error("Synthetic blocked storage");
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.calls.push(["set", key, value]);
    if (this.blocked) throw new Error("Synthetic blocked storage");
    this.values.set(key, value);
  }
  removeItem(key) {
    this.calls.push(["remove", key]);
    if (this.blocked) throw new Error("Synthetic blocked storage");
    this.values.delete(key);
  }
}

function execute(text, globals = {}, imports = {}) {
  const code = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    ...globals,
    require(name) {
      if (!(name in imports)) throw new Error("Unexpected fixture import");
      return imports[name];
    },
  }, { timeout: 1000 });
  return exports;
}

const helperPath = path.join(app, "src/lib/browserStorage.ts");
const helper = fs.existsSync(helperPath) ? execute(fs.readFileSync(helperPath, "utf8")) : {};
function helperImport(ast) {
  return ast.statements.filter((n) =>
    ts.isImportDeclaration(n) && n.moduleSpecifier.text === "@/lib/browserStorage"
  ).map((n) => n.getText(ast)).join("\n");
}

function recent(store) {
  const ast = parsed("SearchScreen.tsx", source("src/components/roy/screens/SearchScreen.tsx"));
  const names = new Set(["RECENT_KEY", "loadRecent", "saveRecent"]);
  const nodes = ast.statements.filter((n) =>
    ts.isFunctionDeclaration(n) ? names.has(n.name?.text) :
      ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => names.has(d.name.getText(ast)))
  );
  assert.equal(nodes.length, 3, "actual recent consumers must all be selected");
  return execute(helperImport(ast) + "\n" + nodes.map((n) => n.getText(ast)).join("\n") +
    "\nexport { loadRecent };", { localStorage: store }, { "@/lib/browserStorage": helper });
}

const navAst = parsed("RoyApp.tsx", source("src/components/roy/RoyApp.tsx"));
const component = navAst.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "RoyApp");
assert(component?.body, "actual RoyApp must be selected");
const declarations = component.body.statements.filter(ts.isVariableStatement)
  .flatMap((n) => [...n.declarationList.declarations]);
function callback(name) {
  const item = declarations.find((n) => n.name.getText(navAst) === name);
  assert(item && ts.isCallExpression(item.initializer));
  assert.equal(item.initializer.expression.getText(navAst), "useCallback");
  return item.initializer.arguments[0].getText(navAst);
}
const effects = component.body.statements.filter((n) =>
  ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) &&
  n.expression.expression.getText(navAst) === "useEffect"
).map((n) => n.expression.arguments[0]);
function effect(marker) {
  const selected = effects.filter((n) => n.getText(navAst).includes(marker));
  assert.equal(selected.length, 1, "select one complete production effect");
  return selected[0].getText(navAst);
}
const navFactory = execute(helperImport(navAst) + `
export function scenario(ctx) {
  const { sessionStorage, window, queryToState, getDeepLinkMeetingId, getDeepLinkTaskId } = ctx;
  const DESKTOP_QUERY = "fixture-desktop";
  const hydrated = ctx.hydrated, fromUrl = ctx.fromUrl;
  let stack = ctx.stack;
  const setTaskView = (value) => ctx.taskView = value;
  const setTabState = (value) => ctx.tab = value;
  const setStack = (value) => { stack = value; ctx.stack = value; };
  const openMeeting = (id) => ctx.openedMeeting = id;
  return {
    setTab: ${callback("setTab")},
    openTasks: ${callback("openTasks")},
    restore: ${effect("getDeepLinkMeetingId()")},
    persist: ${effect("JSON.stringify(stack)")},
  };
}`, {}, { "@/lib/browserStorage": helper }).scenario;

function nav(store, options = {}) {
  const ctx = {
    sessionStorage: store,
    window: { location: { search: options.search ?? "" }, matchMedia: () => ({ matches: options.desktop !== false }) },
    queryToState: () => options.address ?? {},
    getDeepLinkMeetingId: () => options.meetingId ?? null,
    getDeepLinkTaskId: () => null,
    hydrated: { current: options.hydrated ?? false },
    fromUrl: { current: false },
    tab: "search", stack: options.stack ?? [], taskView: null,
  };
  return { ctx, actions: navFactory(ctx) };
}

const oldRoute = [{ view: "record", params: { id: "synthetic-old" } }];
const newRoute = [{ view: "record", params: { id: "synthetic-new" } }];
const tests = [];
function test(name, fn) {
  try { fn(); tests.push({ name, status: "PASS" }); }
  catch (error) { tests.push({ name, status: "FAIL", error: error.name }); }
}

test("legacy navigation tab and full route params survive upgrade", () => {
  const s = new Store({ roy_tab: "task", roy_stack: JSON.stringify(oldRoute) });
  const { ctx, actions } = nav(s); actions.restore();
  assert.equal(ctx.tab, "task"); assert.deepEqual(plain(ctx.stack), oldRoute);
  assert.equal(ctx.hydrated.current, true);
});
test("canonical navigation values are read without legacy keys", () => {
  const s = new Store({ swarm_tab: "book", swarm_stack: JSON.stringify(newRoute) });
  const { ctx, actions } = nav(s); actions.restore();
  assert.equal(ctx.tab, "book"); assert.deepEqual(plain(ctx.stack), newRoute);
});
test("canonical namespace wins over legacy navigation", () => {
  const s = new Store({ swarm_tab: "book", roy_tab: "task", swarm_stack: JSON.stringify(newRoute), roy_stack: JSON.stringify(oldRoute) });
  const { ctx, actions } = nav(s); actions.restore();
  assert.equal(ctx.tab, "book"); assert.deepEqual(plain(ctx.stack), newRoute);
});
test("a present empty canonical value does not revive a legacy tab", () => {
  const { ctx, actions } = nav(new Store({ swarm_tab: "", roy_tab: "book" })); actions.restore();
  assert.equal(ctx.tab, "search");
});
test("tab callback writes only canonical key and retains its other state effects", () => {
  const s = new Store({ roy_tab: "book" });
  const { ctx, actions } = nav(s, { stack: oldRoute }); actions.setTab("market");
  assert.equal(s.values.get("swarm_tab"), "market"); assert.equal(s.values.get("roy_tab"), "book");
  assert.equal(ctx.tab, "market"); assert.deepEqual(plain(ctx.stack), []); assert.equal(ctx.taskView, null);
});
test("openTasks callback retains raw lens/list and writes canonical task tab", () => {
  const s = new Store({ roy_tab: "book" });
  const { ctx, actions } = nav(s, { stack: oldRoute }); actions.openTasks("mine", "today");
  assert.equal(s.values.get("swarm_tab"), "task"); assert.equal(s.values.get("roy_tab"), "book");
  assert.deepEqual(plain(ctx.taskView), { lens: "mine", list: "today" }); assert.deepEqual(plain(ctx.stack), []);
});
test("hydrated stack persists raw route IDs only to canonical key", () => {
  const s = new Store({ roy_stack: JSON.stringify(oldRoute) });
  const { actions } = nav(s, { hydrated: true, stack: newRoute }); actions.persist();
  assert.equal(s.values.get("swarm_stack"), JSON.stringify(newRoute)); assert.equal(s.values.get("roy_stack"), JSON.stringify(oldRoute));
});
test("initial unhydrated effect never overwrites either stored stack", () => {
  const s = new Store({ roy_stack: JSON.stringify(oldRoute), swarm_stack: JSON.stringify(newRoute) });
  nav(s).actions.persist(); assert.equal(s.calls.length, 0);
});
test("explicit empty stack clears both namespaces and cannot resurrect old detail", () => {
  const s = new Store({ roy_stack: JSON.stringify(oldRoute), swarm_stack: JSON.stringify(newRoute) });
  nav(s, { hydrated: true }).actions.persist();
  assert.equal(s.values.has("swarm_stack"), false); assert.equal(s.values.has("roy_stack"), false);
  const again = nav(s); again.actions.restore(); assert.deepEqual(plain(again.ctx.stack), []);
});
test("invalid canonical stack follows the old parser instead of legacy fallback", () => {
  const { ctx, actions } = nav(new Store({ swarm_stack: "broken-json", roy_stack: JSON.stringify(oldRoute) }));
  actions.restore(); assert.deepEqual(plain(ctx.stack), []); assert.equal(ctx.hydrated.current, true);
});
test("URL state still precedes all stored state", () => {
  const s = new Store({ swarm_tab: "book", roy_tab: "task" });
  const { ctx, actions } = nav(s, { address: { tab: "market", route: newRoute[0] } }); actions.restore();
  assert.equal(ctx.tab, "market"); assert.deepEqual(plain(ctx.stack), newRoute); assert.equal(ctx.fromUrl.current, true);
  assert.equal(s.calls.length, 0);
});
test("existing mobile desktop-tab mapping is retained", () => {
  const { ctx, actions } = nav(new Store({ swarm_tab: "book", roy_tab: "book" }), { desktop: false }); actions.restore();
  assert.equal(ctx.tab, "more");
});
test("blocked navigation storage retains existing catch/hydration behavior", () => {
  const { ctx, actions } = nav(new Store({}, true)); actions.restore(); assert.equal(ctx.hydrated.current, true);
});
test("legacy recent queries retain parser, order and values", () => {
  const r = recent(new Store({ roy_recent_searches: JSON.stringify(["Synthetic A", 5, "Synthetic B"]) }));
  assert.deepEqual(plain(r.loadRecent()), ["Synthetic A", "Synthetic B"]);
});
test("canonical recent queries win over legacy history", () => {
  const r = recent(new Store({ swarm_recent_searches: JSON.stringify(["Synthetic New"]), roy_recent_searches: JSON.stringify(["Synthetic Old"]) }));
  assert.deepEqual(plain(r.loadRecent()), ["Synthetic New"]);
});
test("saving recent query writes canonical only with original dedup/order/cap", () => {
  const original = Array.from({ length: 10 }, (_, i) => "Synthetic " + i);
  const s = new Store({ roy_recent_searches: JSON.stringify(original) });
  recent(s).saveRecent("Synthetic 2");
  assert.deepEqual(JSON.parse(s.values.get("swarm_recent_searches")), ["Synthetic 2", ...original.filter((q) => q !== "Synthetic 2")].slice(0, 8));
  assert.equal(s.values.get("roy_recent_searches"), JSON.stringify(original));
});
test("invalid canonical recent history does not revive old history", () => {
  const r = recent(new Store({ swarm_recent_searches: "broken-json", roy_recent_searches: JSON.stringify(["Synthetic Old"]) }));
  assert.deepEqual(plain(r.loadRecent()), []);
});
test("blocked recent storage retains existing empty/caught behavior", () => {
  const r = recent(new Store({}, true)); assert.deepEqual(plain(r.loadRecent()), []); r.saveRecent("Synthetic");
});

const report = { passed: tests.filter((t) => t.status === "PASS").length, failed: tests.filter((t) => t.status === "FAIL").length, cases: tests };
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
