import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectSection, checkI18n } from "./check-i18n.mjs";
import { migrateSection } from "../miniapp/scripts/i18n-migrate.mjs";
import { generateCatalog, parseDictionary } from "../miniapp/scripts/i18n-catalog.mjs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../miniapp/package.json", import.meta.url)), ts = require("typescript");

const keys = new Set(["example.label"]);
const section = (value) => `import { useT } from '@/components/roy/nav'; export function A({ task }) { const t = useT(); ${value} }`;
test("migrated sections accept keys, technical attributes and user content", () => {
  assert.deepEqual(inspectSection(section('return <button className="text-ink" role="switch" title={t("example.label")}>{task.title}{t("example.label")}</button>;'), "a.tsx", keys), []);
  assert.equal(checkI18n().sections, 1);
  assert.deepEqual(inspectSection(section('const options=[{id:"one",label:t("example.label")}]; return <select>{options.map(o=><option key={o.id}>{o.label}</option>)}</select>;'), "a.tsx", keys), []);
});
for (const [name, value] of Object.entries({
  English: 'return <p>Notification sound</p>;',
  Russian: 'return <p>Звук</p>;',
  attribute: 'return <input placeholder="Search" />;',
  expression: 'return <p>{"Label"}</p>;',
  constant: 'const copy = "Label"; return <p>{copy}</p>;',
  alias: 'const copy = "Label"; const alias = copy; return <p>{alias}</p>;',
  object: 'const copy = { label: "Label" }; return <p>{copy.label}</p>;',
  template: 'return <p>{`Hello ${task.name}`}</p>;',
  conditional: 'return <p>{task.done ? "Done" : "Open"}</p>;',
  mapped: 'const options=[{id:"one",label:"Untranslated label"}]; return <select>{options.map(o=><option>{o.label}</option>)}</select>;',
  mappedText: 'const options=["Untranslated label"]; return <p>{options.map(o=>o)}</p>;',
  unknown: 'return <p>{t("unknown.key")}</p>;',
  dynamic: 'return <p>{t(task.title)}</p>;',
  legacy: 'const dt = useDt(); return <p>{dt("Р", "E")}</p>;',
})) test(`rejects ${name} bypass`, () => assert.ok(inspectSection(section(value), "a.tsx", keys).length > 0));
test("registry rejects removal of useT even when no literal remains", () => {
  assert.ok(inspectSection('export function A({ task }) { return <p>{task.title}</p>; }', "a.tsx", keys).length);
});
test("local variable and map parameter names cannot contaminate another lexical scope", () => {
  const source = `import {useT} from '@/components/roy/nav';
    function Choices(){const t=useT(); const label='UNRENDERED';const options=[{id:'one',label:'UNRENDERED'}];return <select>{options.map(item=><option key={item.id}>{t('example.label')}</option>)}</select>;}
    function UserItems({items,task}){const t=useT(); const label=task.title;return <><p>{label}</p>{items.map(item=><span>{item.label}</span>)}</>;}`;
  assert.deepEqual(inspectSection(source, "a.tsx", keys), []);
  assert.ok(inspectSection(source.replace("{t('example.label')}", "{item.label}"), "a.tsx", keys).length);
});
test("codemod extracts exact strings and edits only translation spans", () => {
  const source = 'import { useDt } from "@/components/roy/nav"; function A(){const dt = useDt(); return <p className="x">{dt("Привет $&", "Hello $&")}</p>}';
  const result = migrateSection(source, ["example.label"]);
  assert.deepEqual(result.messages, { ru: { "example.label": "Привет $&" }, en: { "example.label": "Hello $&" } });
  assert.equal(result.source, 'import { useT } from "@/components/roy/nav"; function A(){const t = useT(); return <p className="x">{t("example.label")}</p>}');
});
test("codemod rejects dynamic copy, duplicate keys, reused references and name collisions", () => {
  const base = 'import { useDt } from "@/components/roy/nav"; function A(){const dt = useDt(); return dt("Р", "E");}';
  for (const source of [base.replace('"Р"', 'task.title'), base.replace('return dt', 'const other = dt; return dt'), base.replace('return dt', 'const t = 1; return dt'), base.replace('"Р", "E"', '"Literal {{name}}", "Literal {{name}}"'), base.replace('"Р", "E"', '"Literal $t(other.title)", "Literal $t(other.title)"')]) {
    assert.throws(() => migrateSection(source, ["example.label"]));
  }
  assert.throws(() => migrateSection(base, ["example.label", "example.label"]));
});
test("strict dictionaries reject duplicate JSON keys", () => {
  assert.throws(() => parseDictionary('{"a":"one","a":"two"}', "en.json"), /duplicate/);
});
test("a third language is discovered from a file; stale generation fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-i18n-")), directory = path.join(root, "src/lib/i18n/locales");
  try {
    fs.mkdirSync(directory, { recursive: true });
    for (const [language, text] of Object.entries({ en: "Hello", ru: "Привет" })) fs.writeFileSync(path.join(directory, `${language}.json`), JSON.stringify({ "example.label": text }));
    assert.deepEqual(generateCatalog(root).languages, ["en", "ru"]);
    fs.writeFileSync(path.join(directory, "sr.json"), JSON.stringify({ "example.label": "Zdravo" }));
    assert.throws(() => generateCatalog(root, true), /stale/);
    assert.deepEqual(generateCatalog(root).languages, ["en", "ru", "sr"]);
    assert.equal(generateCatalog(root, true).keys, 1);
    fs.writeFileSync(path.join(directory, "sr.json"), '{}');
    assert.throws(() => generateCatalog(root), /key mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the real gate rejects English in a new section and tampered registered sections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-i18n-gate-")), app = path.join(root, "miniapp");
  try {
    fs.mkdirSync(path.join(app, "src/components"), { recursive: true });
    fs.mkdirSync(path.join(app, "scripts"));
    fs.mkdirSync(path.join(app, "src/lib/i18n/locales"), { recursive: true });
    for (const language of ["en", "ru"]) fs.writeFileSync(path.join(app, `src/lib/i18n/locales/${language}.json`), JSON.stringify({ "example.label": "Label" }));
    generateCatalog(app);
    fs.writeFileSync(path.join(app, "scripts/i18n-legacy-sections.json"), "[]");
    fs.writeFileSync(path.join(app, "scripts/i18n-migrated.json"), '["src/components/A.tsx"]');
    fs.writeFileSync(path.join(app, "src/components/A.tsx"), section('return <p>{t("example.label")}</p>;'));
    assert.equal(checkI18n(root).sections, 1);
    const newFile = path.join(app, "src/components/New.tsx");
    fs.writeFileSync(newFile, 'export function New(){ return <p>Hello</p>; }');
    assert.throws(() => checkI18n(root), /raw JSX copy/);
    fs.writeFileSync(newFile, 'export function New(){ return <hr className="border-line"/>; }');
    assert.equal(checkI18n(root).sections, 2);
    fs.unlinkSync(newFile);
    fs.writeFileSync(path.join(app, "src/components/A.tsx"), section('return <p>Label</p>;'));
    assert.throws(() => checkI18n(root), /raw JSX copy/);
    fs.writeFileSync(path.join(app, "src/components/A.tsx"), 'export function A({task}) {return <p>{task.title}</p>;}');
    assert.throws(() => checkI18n(root), /must retain useT/);
    fs.unlinkSync(path.join(app, "src/components/A.tsx"));
    assert.throws(() => checkI18n(root), /ENOENT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("TypeScript rejects unknown keys and missing, extra or non-numeric plural parameters", () => {
  const app = path.resolve("miniapp"), filename = path.join(app, "src/lib/i18n/.types-fixture.ts");
  const source = `import {createDictionaryRuntime} from './runtime';
    const get = createDictionaryRuntime({en:{title:'Hello',hello:'Hello {{name}}',item_one:'{{count}} {{name}}',item_other:'{{count}} {{name}}'}} as const);
    const t = get('en'); t('title'); t('hello',{name:'A'}); t('item',{count:2,name:'A'});
    // @ts-expect-error unknown key
    t('missing');
    // @ts-expect-error missing name
    t('hello');
    // @ts-expect-error missing count
    t('item',{name:'A'});
    // @ts-expect-error count must be numeric
    t('item',{name:'A',count:'2'});
    // @ts-expect-error options cannot override language
    t('hello',{name:'A',lng:'ru'});
  `;
  const config = ts.readConfigFile(path.join(app, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
  function check(source) {
    const host = ts.createCompilerHost(parsed.options), readFile = host.readFile, fileExists = host.fileExists;
    host.readFile = (file) => file === filename ? source : readFile(file);
    host.fileExists = (file) => file === filename || fileExists(file);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], { ...parsed.options, incremental: false }, host));
  }
  const diagnostics = check(source);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => app, getNewLine: () => "\n" }));
  assert.equal(check(source.replace(/\/\/ @ts-expect-error[^\n]*/g, "")).length, 5, "negative-control program must actually reject all five broken calls");
});
