import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateCatalog, parseDictionary } from "./i18n-catalog.mjs";
import { validateCatalog } from "../src/lib/i18n/validation.mjs";
const require = createRequire(import.meta.url), ts = require("typescript");

/** Migrate one static section. Dynamic pairs require an explicit, separate migration. */
export function migrateSection(source, keys) {
  const tree = ts.createSourceFile("section.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [], bindings = [], calls = [], identifiers = [];
  function visit(node) {
    if (ts.isIdentifier(node)) identifiers.push(node);
    if (ts.isImportSpecifier(node) && node.name.text === "useDt" && !node.propertyName) imports.push(node.name);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useDt") bindings.push(node);
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "dt") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (tree.parseDiagnostics.length || imports.length !== 1 || bindings.length !== 1 || bindings[0].name.text !== "dt") {
    throw new Error("i18n migration: expected one unaliased useDt import and const dt = useDt()");
  }
  if (!calls.length || calls.length !== keys.length || new Set(keys).size !== keys.length || identifiers.some((n) => n.text === "t" || n.text === "useT")) {
    throw new Error("i18n migration: unique keys and unused t/useT names required");
  }
  const allowed = new Set([imports[0], bindings[0].name, bindings[0].initializer.expression, ...calls.map((n) => n.expression)]);
  if (identifiers.some((n) => (n.text === "dt" || n.text === "useDt") && !allowed.has(n))) {
    throw new Error("i18n migration: unsupported translation reference");
  }
  const messages = { ru: {}, en: {} }, edits = [];
  const edit = (node, text) => edits.push({ start: node.getStart(tree), end: node.end, text });
  edit(imports[0], "useT"); edit(bindings[0].name, "t"); edit(bindings[0].initializer.expression, "useT");
  calls.forEach((call, index) => {
    if (call.arguments.length !== 2 || call.arguments.some((n) => !ts.isStringLiteral(n) && !ts.isNoSubstitutionTemplateLiteral(n))) {
      throw new Error("i18n migration: only literal ru/en pairs are supported");
    }
    messages.ru[keys[index]] = call.arguments[0].text;
    messages.en[keys[index]] = call.arguments[1].text;
    edit(call, `t(${JSON.stringify(keys[index])})`);
  });
  if (Object.values(validateCatalog(messages)).some((entry) => entry.parameters.length)) {
    throw new Error("i18n migration: literal pairs with template/plural syntax require explicit migration");
  }
  let result = source;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, start) + text + result.slice(end);
  return { source: result, messages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [filename, ...keys] = process.argv.slice(2).filter((arg) => arg !== "--write");
    if (!filename || !keys.length) throw new Error("usage: node scripts/i18n-migrate.mjs src/components/section.tsx key.one key.two [--write]");
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), target = path.resolve(app, filename);
    if (!target.startsWith(path.join(app, "src/components") + path.sep)) throw new Error("i18n migration: expected a component in this app");
    const migrated = migrateSection(fs.readFileSync(target, "utf8"), keys);
    const directory = path.join(app, "src/lib/i18n/locales"), catalog = {};
    for (const name of fs.readdirSync(directory).filter((n) => n.endsWith(".json"))) {
      const language = name.slice(0, -5), messages = parseDictionary(fs.readFileSync(path.join(directory, name), "utf8"), name);
      for (const [key, text] of Object.entries(migrated.messages[language] ?? {})) {
        if (Object.hasOwn(messages, key) && messages[key] !== text) throw new Error(`i18n migration: key collision ${language}:${key}`);
        messages[key] = text;
      }
      catalog[language] = messages;
    }
    validateCatalog(catalog);
    if (process.argv.includes("--write")) {
      for (const [language, messages] of Object.entries(catalog)) fs.writeFileSync(path.join(directory, `${language}.json`), JSON.stringify(messages, null, 2) + "\n");
      fs.writeFileSync(target, migrated.source);
      generateCatalog(app);
    }
    console.log(JSON.stringify({ file: filename, keys, written: process.argv.includes("--write") }));
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
