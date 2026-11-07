import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const app = fileURLToPath(new URL("../", import.meta.url));
const ts = createRequire(app + "package.json")("typescript");
const source = fs.readFileSync(
  process.env.TASK_STATUS_SOURCE ??
    app + "src/components/roy/screens/TaskDetail.tsx",
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const task = (id = "A", status = "open") => ({
  id,
  status,
  title: "Synthetic " + id,
  description: "Fixture content",
  country: "XD",
  priority: "high",
  source: "manual",
  assignees: [],
  due_date: null,
  created_at: "2026-01-01",
  meeting_id: null,
});
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node);
  return text(node.props?.children);
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    return node.map((n) => find(n, predicate)).find(Boolean) ?? null;
  }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function mount() {
  const values = [], effects = new Map(), gets = [], patches = [];
  let cursor = 0, tree, id = "A", pending = [], writes = 0;
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const module = { exports: {} };
  const modules = {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!(i in values)) {
          values[i] = typeof initial === "function" ? initial() : initial;
        }
        return [values[i], (value) => {
          writes++;
          values[i] = typeof value === "function" ? value(values[i]) : value;
        }];
      },
      useRef(initial) {
        const i = cursor++;
        if (!(i in values)) values[i] = { current: initial };
        return values[i];
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
    "../nav": {
      useRoyNav: () => ({ pop() {}, push() {}, toast() {} }),
      useDt: () => (_ru, en) => en,
    },
    "../ui": new Proxy({}, { get: (_o, name) => String(name) }),
    "../icons": { RoyIcon: "RoyIcon" },
    "../entry": {
      entryTagKey: () => "meeting",
      deriveEntryTitle: () => "Synthetic meeting",
    },
    "@/lib/api": {
      fetchTask(id) {
        const d = deferred();
        gets.push({ id, ...d });
        return d.promise;
      },
      fetchMeeting() {
        throw new Error("Unexpected meeting request");
      },
      updateTask(id, payload) {
        const d = deferred();
        patches.push({ id, payload, ...d });
        return d.promise;
      },
      deleteTask() {
        throw new Error("Unexpected delete request");
      },
    },
    "@/components/tasks/TaskComments": { TaskComments: "TaskComments" },
    "@/components/tasks/TaskFiles": { TaskFiles: "TaskFiles" },
    "@/lib/utils": { displayName: (x) => x },
    "@/lib/displayFormat": { formatDate: () => "01 Jan" },
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(modules[name], "Unexpected module: " + name);
      return modules[name];
    },
  });
  function render(nextId = id) {
    id = nextId;
    cursor = 0;
    tree = module.exports.TaskDetail({ id });
    for (const run of pending.splice(0)) run();
    return tree;
  }
  const button = () =>
    find(
      tree,
      (n) => n.type === "button" && ["Done", "Reopen"].includes(text(n)),
    );
  const current = () => values.find((v) => v?.id && v?.title && v?.status);
  return {
    render,
    patches,
    gets,
    button,
    current,
    writes: () => writes,
    click() {
      return button()?.props.onClick();
    },
    async load(value = task(id)) {
      assert.equal(gets.at(-1).id, value.id);
      gets.at(-1).resolve(value);
      await tick();
      render();
    },
    editFields(fields) {
      // Model another state update while the request is in flight, without changing its handler.
      const i = values.indexOf(current());
      values[i] = { ...values[i], ...fields };
      render();
    },
    unmount() {
      for (const e of effects.values()) e.cleanup?.();
      effects.clear();
    },
  };
}
const cases = [];
async function check(name, run) {
  try {
    await run();
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, assertion: error.message });
  }
}
async function loaded(status = "open") {
  const m = mount();
  m.render();
  await m.load(task("A", status));
  return m;
}
for (const previous of ["open", "done", "progress", "cancelled"]) {
  await check(
    "failure restores exact previous status: " + previous,
    async () => {
      const m = await loaded(previous),
        next = ["done", "cancelled"].includes(previous) ? "open" : "done";
      m.click();
      m.render();
      assert.equal(m.current().status, next);
      assert.equal(m.patches.length, 1);
      assert.equal(m.patches[0].id, "A");
      assert.equal(m.patches[0].payload.status, next);
      m.patches[0].reject(new Error("Synthetic 500"));
      await tick();
      m.render();
      assert.equal(m.current().status, previous);
      assert.equal(!!m.button().props.disabled, false);
    },
  );
}
for (const previous of ["open", "done"]) {
  await check("success retains optimistic status: " + previous, async () => {
    const m = await loaded(previous),
      next = previous === "open" ? "done" : "open";
    m.click();
    m.render();
    m.patches[0].resolve();
    await tick();
    m.render();
    assert.equal(m.current().status, next);
    assert.equal(!!m.button().props.disabled, false);
    m.click();
    assert.equal(m.patches.length, 2);
  });
}
await check(
  "rapid clicks including the same stale handler issue one PATCH",
  async () => {
    const m = await loaded(), click = m.button().props.onClick;
    click();
    click();
    m.render();
    m.click();
    assert.equal(m.patches.length, 1);
    assert.equal(m.button().props.disabled, true);
    m.patches[0].resolve();
    await tick();
    m.render();
    assert.equal(!!m.button().props.disabled, false);
  },
);
await check(
  "old failure cannot unlock or roll back a new task operation",
  async () => {
    const m = await loaded();
    m.click();
    m.render();
    m.render("B");
    await m.load(task("B"));
    m.click();
    m.render();
    m.patches[0].reject(new Error("Old task failure"));
    await tick();
    m.render();
    assert.equal(m.current().id, "B");
    assert.equal(m.current().status, "done");
    assert.equal(m.button().props.disabled, true);
    m.click();
    assert.equal(m.patches.length, 2);
    m.patches[1].reject(new Error("Current task failure"));
    await tick();
    m.render();
    assert.equal(m.current().status, "open");
    assert.equal(!!m.button().props.disabled, false);
  },
);
await check("newer success survives an older task failure", async () => {
  const m = await loaded();
  m.click();
  m.render();
  m.render("B");
  await m.load(task("B"));
  m.click();
  m.render();
  m.patches[1].resolve();
  await tick();
  m.render();
  m.patches[0].reject(new Error("Old failure"));
  await tick();
  m.render();
  assert.equal(m.current().id, "B");
  assert.equal(m.current().status, "done");
});
await check(
  "returning to the same ID ignores an earlier load generation",
  async () => {
    const m = await loaded();
    m.click();
    m.render();
    m.render("B");
    await m.load(task("B"));
    m.render("A");
    await m.load({ ...task("A", "done"), title: "Fresh A" });
    m.patches[0].reject(new Error("Earlier A failure"));
    await tick();
    m.render();
    assert.equal(m.current().status, "done");
    assert.equal(m.current().title, "Fresh A");
    assert.equal(!!m.button().props.disabled, false);
  },
);
await check("unmount blocks late rollback and busy-state writes", async () => {
  const m = await loaded();
  m.click();
  m.render();
  m.unmount();
  const before = m.writes();
  m.patches[0].reject(new Error("After unmount"));
  await tick();
  assert.equal(m.writes(), before);
});
await check(
  "unloaded and stale-ID cards cannot issue a status PATCH",
  async () => {
    const m = mount();
    m.render();
    assert.equal(m.button(), null);
    await m.load();
    m.render("B");
    const b = m.button();
    if (b) {
      assert.equal(b.props.disabled, true);
      b.props.onClick();
    }
    assert.equal(m.patches.length, 0);
  },
);
await check(
  "rollback preserves other fields updated during the request",
  async () => {
    const m = await loaded();
    m.click();
    m.render();
    m.editFields({
      title: "Updated title",
      description: "Updated content",
      priority: "low",
    });
    m.patches[0].reject(new Error("Synthetic failure"));
    await tick();
    m.render();
    assert.equal(m.current().status, "open");
    assert.equal(m.current().title, "Updated title");
    assert.equal(m.current().description, "Updated content");
    assert.equal(m.current().priority, "low");
  },
);
await check(
  "StrictMode effect replay ignores the first setup and remains usable",
  async () => {
    const m = mount();
    m.render();
    const firstGet = m.gets[0];
    m.unmount();
    m.render();
    assert.equal(m.gets.length, 2);
    firstGet.resolve({ ...task("A", "done"), title: "Discarded replay" });
    await tick();
    m.render();
    assert.equal(m.current(), undefined);
    await m.load(task("A"));
    m.click();
    m.render();
    assert.equal(m.patches.length, 1);
    m.patches[0].reject(new Error("After replay"));
    await tick();
    m.render();
    assert.equal(m.current().status, "open");
    assert.equal(!!m.button().props.disabled, false);
  },
);
await check("returning A before fresh GET must stay unloaded", async () => {
  const m = await loaded();
  m.render("B");
  m.render("A");
  m.render(); // Commit state updates from the new load effect before clicking.
  assert.equal(m.gets.length, 3);
  m.click();
  assert.equal(
    m.patches.length,
    0,
    "new A load is still pending; old A state must not authorize PATCH",
  );
});
await check(
  "pending ABA status operation must not overwrite fresh GET status",
  async () => {
    const m = await loaded();
    m.render("B");
    m.render("A");
    m.render(); // Commit state updates from the new load effect before clicking.
    m.click();
    await m.load({ ...task("A", "done"), title: "Fresh A" });
    if (m.patches.length) {
      m.patches[0].reject(new Error("Synthetic failure"));
      await tick();
      m.render();
    }
    assert.equal(
      m.current().status,
      "done",
      "fresh A status must survive a PATCH based on pre-load stale state",
    );
  },
);
await check(
  "previous generation retained handler cannot roll back newly loaded A",
  async () => {
    const m = await loaded(), oldClick = m.button().props.onClick;
    m.render("B");
    await m.load(task("B"));
    m.render("A");
    await m.load({ ...task("A", "done"), title: "Fresh A" });
    oldClick();
    assert.equal(
      m.patches.length,
      0,
      "retained handler must not start a PATCH for a new generation",
    );
    if (m.patches.length) {
      m.patches[0].reject(new Error("Synthetic failure"));
      await tick();
      m.render();
    }
    assert.equal(
      m.current().status,
      "done",
      "retained old-A handler must not restore old open over fresh done",
    );
  },
);
const failed = cases.filter((c) => !c.passed).length;
console.log(
  JSON.stringify({
    sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
    cases,
    passed: cases.length - failed,
    failed,
    network: 0,
    externalWrites: 0,
    models: 0,
  }),
);
process.exitCode = failed ? 1 : 0;
