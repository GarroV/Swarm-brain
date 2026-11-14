// Real React SSR and source callbacks, no server/API/model/browser.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url)),
  native = createRequire(path.join(app, "package.json"));
const ts = native("typescript"),
  React = native("react"),
  { renderToStaticMarkup } = native("react-dom/server");
const jsx = native("react/jsx-runtime"), cache = new Map();
let buttons = [];
const runtime = Object.fromEntries(
  Object.entries(jsx).map(([key, value]) => [
    key,
    typeof value === "function"
      ? (...args) => {
        const element = value(...args);
        if (element.type === "button") buttons.push(element);
        return element;
      }
      : value,
  ]),
);
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  let source = fs.readFileSync(filename, "utf8");
  if (filename.endsWith("/MeetingReview.tsx")) {
    // Exact source fragments; the full compiled page is verified separately in CFT.
    const tree = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const helpers = tree.statements.filter((node) =>
      ts.isFunctionDeclaration(node) &&
      ["fmtTs", "fmtClock"].includes(node.name?.text)
    );
    const review = tree.statements.find((node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "MeetingReview"
    );
    const notes = review.body.statements.filter((node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) =>
        ["combinedNotes", "notesBlock"].includes(d.name.getText(tree))
      )
    );
    assert.equal(helpers.length, 2);
    assert.ok(notes.length >= 1);
    source =
      'import { MANUAL_MERGE_COPY } from "./meeting-review/ManualMergeQuestion";\n' +
      helpers.map((n) => n.getText(tree)).join("\n") +
      '\nexport function NotesFixture({meeting,liveNotes,dt}){const panel=true; const SectionLabel=()=>{throw new Error("unexpected header")};\n' +
      notes.map((n) => n.getText(tree)).join("\n") + "\nreturn notesBlock;}";
  }
  const module = { exports: {} };
  const requireLocal = (specifier) => {
    if (specifier === "react/jsx-runtime") return runtime;
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
      return native(specifier);
    }
    const base = specifier.startsWith("@/")
      ? path.join(app, "src", specifier.slice(2))
      : path.resolve(path.dirname(filename), specifier);
    const file = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
    ].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    assert.ok(file, `Cannot resolve ${specifier}`);
    return load(file);
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
    console,
    process: { env: {} },
  }, { filename, timeout: 2000 });
  cache.set(filename, module.exports);
  return module.exports;
}
const { ManualMergeQuestion } = load(
  path.join(app, "src/components/meeting-review/ManualMergeQuestion.tsx"),
);
const { RoyNavContext } = load(path.join(app, "src/components/roy/nav.ts"));
const cases = [];
for (const lang of ["ru", "en"]) {
  for (const busy of [false, true]) {
    for (const replace of [false, true]) {
      const decisions = [], title = "Partner $& <script>{{x}}</script>";
      const candidate = {
        sourceMeetingId: "source",
        base: busy ? "personal" : "workspace",
        target: {
          kind: "entry",
          id: "target",
          title,
          startedAt: "2026-11-14T08:00:00Z",
          recorderNames: ["Synthetic Recorder"],
          inBase: true,
        },
        snapshotToken: "opaque",
        arbitration: {
          replace,
          reason: replace ? "incoming_richer" : "published_edited",
        },
      };
      buttons = [];
      const html = renderToStaticMarkup(
        React.createElement(
          RoyNavContext.Provider,
          { value: { me: { is_demo: lang === "en" } } },
          React.createElement(ManualMergeQuestion, {
            candidate,
            busy,
            onDecision: (decision) => decisions.push(decision),
          }),
        ),
      );
      assert.deepEqual(decisions, []);
      assert.equal(buttons.length, 2);
      assert.equal(
        buttons.every((button) =>
          button.props.disabled === busy && button.props.type === "button"
        ),
        true,
      );
      assert.ok(
        html.includes(lang === "en" ? "Is this the meeting" : "Это встреча"),
      );
      assert.ok(
        html.includes("Partner $&amp; &lt;script&gt;{{x}}&lt;/script&gt;"),
      );
      assert.ok(!html.includes("<script>"));
      assert.ok(html.includes(
        replace
          ? lang === "en"
            ? "more complete transcript"
            : "более полная расшифровка"
          : lang === "en"
          ? "current summary"
          : "Текущие тезисы",
      ));
      assert.ok(
        html.includes(lang === "en" ? "Yes, combine" : "Да, объединить"),
      );
      assert.ok(
        html.includes(
          lang === "en" ? "No, a different meeting" : "Нет, другая встреча",
        ),
      );
      assert.ok(html.includes("Synthetic Recorder") && html.includes("2026"));
      assert.ok(html.includes(
        lang === "en"
          ? busy ? "personal base" : "team base"
          : busy
          ? "личной базе"
          : "базе команды",
      ));
      if (!busy) {
        buttons[0].props.onClick();
        buttons[1].props.onClick();
        assert.deepEqual(decisions, ["merge", "separate"]);
      } else assert.ok(html.includes('role="status"'));
      cases.push({ lang, busy, replace, status: "PASS" });
    }
  }
}
process.env.TZ = "UTC";
const { NotesFixture } = load(
  path.join(app, "src/components/MeetingReview.tsx"),
);
const noteCases = [];
for (const lang of ["ru", "en"]) {
  const dt = (ru, en) => lang === "en" ? en : ru;
  const first = {
    id: "one",
    meeting_id: "target",
    offset_sec: 60,
    text: "Target note",
    author_name: "Target Author",
    recording_started_at: "2026-11-14T08:00:00Z",
  };
  const second = {
    id: "two",
    meeting_id: "source",
    offset_sec: 60,
    text: "Source note",
    author_name: "Source Author",
    recording_started_at: "2026-11-14T08:05:00Z",
  };
  const render = (liveNotes) =>
    renderToStaticMarkup(
      React.createElement(NotesFixture, {
        meeting: { id: "target", started_at: first.recording_started_at },
        liveNotes,
        dt,
      }),
    );
  assert.equal(
    render([first]),
    '<div class="mb-4"><div class="space-y-1.5"><div class="flex gap-2.5 text-sm"><span class="shrink-0 font-mono text-xs tabular-nums text-ink-mute">01:00</span><span class="flex-1 whitespace-pre-wrap text-ink">Target note</span></div></div></div>',
  );
  noteCases.push({ lang, mode: "legacy-html-exact", status: "PASS" });
  const combined = render([first, second]);
  for (
    const expected of [
      "08:01:00",
      "08:06:00",
      "Source Author:",
      "Target Author:",
      "Source note",
      "Target note",
    ]
  ) {
    assert.ok(
      combined.includes(expected),
      `Missing original note context: ${expected}`,
    );
  }
  const rowOf = (html, text) =>
    html.split('<div class="flex gap-2.5 text-sm">').find((row) =>
      row.includes(text)
    );
  const clockOf = (row) => row.match(/<span[^>]*>([^<]*)<\/span>/)?.[1];
  assert.equal(clockOf(rowOf(combined, "Target note")), "08:01:00");
  assert.equal(clockOf(rowOf(combined, "Source note")), "08:06:00");
  assert.ok(rowOf(combined, "Source note").includes("Source Author:"));
  assert.ok(rowOf(combined, "Target note").includes("Target Author:"));
  noteCases.push({ lang, mode: "original-clocks-and-authors", status: "PASS" });
  const missing = render([first, {
    ...second,
    recording_started_at: null,
    author_name: null,
  }]);
  assert.ok(missing.includes("01:00"));
  assert.ok(!missing.includes("08:06:00"));
  assert.ok(
    missing.includes(lang === "en" ? "Unknown author" : "Автор неизвестен"),
  );
  assert.equal(clockOf(rowOf(missing, "Source note")), "01:00");
  noteCases.push({
    lang,
    mode: "no-invented-recording-start-or-name",
    status: "PASS",
  });
}
console.log(
  JSON.stringify({
    passed: cases.length,
    notesPassed: noteCases.length,
    failed: 0,
    cases,
    noteCases,
  }),
);
