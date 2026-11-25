// Compile the whole SprintsScreen and render real SprintRow/SprintPulse through React SSR.
// Seeded hook state, no effects; list adapter forwards the actual parent showExtra prop.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  req = createRequire(root + "/miniapp/package.json"),
  ts = req("typescript"),
  React = req("react"),
  jsx = req("react/jsx-runtime"),
  { renderToStaticMarkup } = req("react-dom/server");
const source = (p) => fs.readFileSync(path.join(root, p), "utf8");
const screenPath = "miniapp/src/components/tasks/SprintsScreen.tsx",
  screen = source(screenPath),
  tree = ts.createSourceFile(
    screenPath,
    screen,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  fn = tree.statements.find((n) =>
    ts.isFunctionDeclaration(n) && n.name.text === "SprintsScreen"
  );
const stateNames = [];
for (const n of fn.body.statements) {
  if (ts.isVariableStatement(n)) {
    for (const d of n.declarationList.declarations) {
      if (
        ts.isArrayBindingPattern(d.name) &&
        ts.isCallExpression(d.initializer) &&
        d.initializer.expression.getText(tree) === "useState"
      ) stateNames.push(d.name.elements[0].name.text);
    }
  }
}
let seeds, cursor = 0, items, api = 0, observed, lang = "en";
const hooks = {
  ...React,
  useState(initial) {
    const name = stateNames[cursor++];
    return [
      name && Object.hasOwn(seeds, name)
        ? seeds[name]
        : typeof initial === "function"
        ? initial()
        : initial,
      () => {},
    ];
  },
  useEffect() {},
  useMemo(fn) {
    return fn();
  },
  useCallback(fn) {
    return fn;
  },
};
const cache = new Map(),
  Null = () => null,
  cn = (...xs) => xs.filter((x) => typeof x === "string").join(" ");
const dt = (ru, en) => lang === "en" ? en : ru;
let SprintRow;
function load(p) {
  if (cache.has(p)) return cache.get(p);
  const text = source(p), m = { exports: {} };
  const need = (n) => {
    if (n === "react") return hooks;
    if (n === "react/jsx-runtime") return jsx;
    if (n === "react-dom") return { createPortal: (x) => x };
    if (n === "@/components/roy/nav") {
      return {
        useDt: () => dt,
        useRoyNav: () => ({ me: { telegram_id: 1, is_admin: false } }),
      };
    }
    if (n === "@/lib/initiatives") {
      return load("miniapp/src/lib/initiatives.ts");
    }
    if (n === "@/lib/api") {
      return new Proxy({}, {
        get: () => () => {
          api++;
          throw Error("unexpected API");
        },
      });
    }
    if (n === "@/lib/utils") return { cn, displayName: (x) => x };
    if (n.endsWith("/SprintPulse")) {
      const real = load("miniapp/src/components/tasks/sprints/SprintPulse.tsx");
      return {
        SprintPulse: (props) => {
          observed.pulseExtra = props.extra;
          return React.createElement(real.SprintPulse, props);
        },
      };
    }
    if (n.endsWith("/SprintRow")) {
      return load("miniapp/src/components/tasks/sprints/SprintRow.tsx");
    }
    if (n.endsWith("/InitiativeList")) {
      return {
        BoardSkeleton: Null,
        InitiativeList: (props) => {
          observed.showExtra = props.showExtra;
          observed.mutableControls = [props.onAdd, props.onDone, props.onCheck]
            .some((fn) => typeof fn === "function");
          return React.createElement(
            React.Fragment,
            null,
            ...items.map((item) =>
              React.createElement(SprintRow, {
                key: item.id,
                item,
                unchecked: false,
                showExtra: props.showExtra,
                h: {},
              })
            ),
          );
        },
      };
    }
    if (n.endsWith("/useStoredFlag")) {
      return { useStoredFlag: () => [false, () => {}] };
    }
    if (n.endsWith("/useIsDesktop")) return { useIsDesktop: () => true };
    if (n.endsWith("/ViewToggle")) {
      return {
        useSprintView: () => ["list", () => {}],
        useSprintGrouping: () => ["initiatives", () => {}],
        SprintTabs: Null,
        GroupingToggle: Null,
      };
    }
    if (n.endsWith("/useDragGroups")) {
      return {
        useDragGroups: () => ({ grouping: { busy: false, onAddGroup() {} } }),
      };
    }
    if (n.endsWith("/sprintMine")) {
      return { splitMine: () => ({ mine: [], others: items }) };
    }
    if (n.endsWith("/boardModel")) {
      return { isClosedStatus: (s) => ["done", "cancelled"].includes(s) };
    }
    if (n.endsWith("/format") || n === "./format") {
      return {
        fmtDay: () => "",
        fmtDayShort: () => "",
        isOverdue: () => false,
      };
    }
    if (n.endsWith("/atoms")) {
      return new Proxy({
        AvatarDirectoryProvider: ({ children }) =>
          React.createElement(React.Fragment, null, children),
      }, {
        get: (o, k) =>
          o[k] ?? (String(k) === String(k).toUpperCase() ? "" : Null),
      });
    }
    if (n.endsWith("/cycleDraft")) {
      return {
        iso: () => "2026-11-14",
        defaultCycleName: () => "Synthetic",
      };
    }
    if (n.endsWith("/sprintsFlag")) {
      return { isSprintTimelineEnabled: () => false, LOAD_SEARCH: "" };
    }
    if (n.endsWith("/confirm")) {
      return {
        useConfirm: () => () => {
          throw Error("unexpected confirmation");
        },
      };
    }
    if (n.endsWith("/useTaskDialogs")) return { useTaskDialogs: () => ({}) };
    if (n.endsWith("/WidePane")) return { useWidePane() {} };
    return new Proxy({}, {
      get: (_, k) =>
        typeof k === "string" && /^[A-Z]/.test(k) ? Null : () => ({}),
    });
  };
  vm.runInNewContext(
    ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    { module: m, exports: m.exports, require: need, console, Date, Set, Map },
  );
  cache.set(p, m.exports);
  return m.exports;
}
const { SprintsScreen } = load(screenPath);
SprintRow =
  load("miniapp/src/components/tasks/sprints/SprintRow.tsx").SprintRow;
const results = [];
for (lang of ["ru", "en"]) {
  for (
    const [name, flags, expected] of [
      ["active_zero_plan_one_extra", [false], 1],
      ["active_mixed_control", [true, false], 1],
      ["active_plan_only_control", [true], 0],
      ["draft_control", [true], 0],
      ["accepted_zero_plan_control", [false], 1],
    ]
  ) {
    cursor = 0;
    observed = {};
    items = flags.map((in_plan, i) => ({
      id: "item" + i,
      task_id: "task" + i,
      title: "Synthetic item",
      status: "open",
      in_plan,
      assignees: ["Synthetic"],
      assignee_telegram_ids: [1],
      project: null,
      project_id: null,
      removed: false,
      frozen: name === "accepted_zero_plan_control",
      check_status: null,
      comment_count: 0,
      link_count: 0,
      carry_count: 0,
    }));
    const detail = {
      id: "cycle",
      name: "Synthetic cycle",
      tab_id: "space",
      status: name === "draft_control"
        ? "draft"
        : name === "accepted_zero_plan_control"
        ? "accepted"
        : "active",
      start_date: "2026-11-14",
      end_date: "2026-11-28",
      items,
      withdrawn: [],
      moved: [],
    };
    seeds = {
      cycles: [detail],
      spaces: [{ id: "space", name: "Synthetic space" }],
      addingTo: undefined,
      space: "space",
      spacePicked: true,
      selectedId: "cycle",
      detail,
      tasks: [],
      projects: [],
      loading: false,
      reportOpen: false,
      form: { name: "", start_date: "", end_date: "" },
    };
    const html = renderToStaticMarkup(React.createElement(SprintsScreen));
    results.push({
      name,
      lang,
      expected,
      showExtra: observed.showExtra,
      mutableControls: observed.mutableControls,
      pulseExtra: observed.pulseExtra,
      extraLabels:
        (html.match(lang === "en" ? />extra</g : />сверх плана</g) || [])
          .length,
      status: html.includes(lang === "en" ? ">extra<" : ">сверх плана<") ===
          !!expected
        ? "PASS"
        : "EXPECTED_RED",
    });
    assert.equal(api, 0);
    if (name === "accepted_zero_plan_control") {
      assert.equal(
        observed.mutableControls,
        false,
        "accepted snapshot keeps mutation controls absent",
      );
    }
    if (expected && flags.some(Boolean)) assert.equal(observed.showExtra, true);
    if (!expected) {
      assert.equal(
        html.includes(lang === "en" ? ">extra<" : ">сверх плана<"),
        false,
      );
    }
  }
}
for (const result of results) {
  assert.equal(
    result.pulseExtra,
    result.expected,
    `${result.lang}/${result.name}: extra count`,
  );
  assert.equal(
    result.extraLabels,
    result.expected ? result.expected + 1 : 0,
    `${result.lang}/${result.name}: row/Pulse extra labels`,
  );
  if (result.name === "draft_control") {
    assert.equal(result.showExtra, false, "draft is not started");
  }
}
console.log(
  JSON.stringify({ passed: results.length, API: api, cases: results }),
);
