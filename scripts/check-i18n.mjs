import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateCatalog, parseDictionary } from "../miniapp/scripts/i18n-catalog.mjs";
import { validateCatalog } from "../miniapp/src/lib/i18n/validation.mjs";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(repository, "miniapp/package.json")), ts = require("typescript");
const textAttributes = new Set(["title", "placeholder", "aria-label", "aria-description", "alt", "label", "description", "tooltip", "emptyText"]);

/** Opted-in sections must render UI copy through literal dictionary keys. */
export function inspectSection(source, filename, keys, requireTranslator = true) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Bind this file without resolving imports: symbol identity preserves lexical scopes.
  const host = {
    getSourceFile: (name) => name === filename ? tree : undefined,
    getDefaultLibFileName: () => "", writeFile: () => {}, getCurrentDirectory: () => "",
    getDirectories: () => [], getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: (name) => name === filename, readFile: (name) => name === filename ? source : undefined,
  };
  const checker = ts.createProgram([filename], { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve }, host).getTypeChecker();
  const binding = (node) => checker.getSymbolAtLocation(node);
  const errors = [], definitions = new Map();
  const report = (node, reason) => errors.push(`${filename}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${reason}`);
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = binding(node.name), entries = definitions.get(symbol) ?? [];
      if (symbol) { entries.push(node.initializer); definitions.set(symbol, entries); }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
      const callback = node.arguments[0], parameter = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback.parameters[0]?.name : null;
      if (parameter && ts.isIdentifier(parameter)) {
        const symbol = binding(parameter), entries = definitions.get(symbol) ?? [];
        if (symbol) { entries.push(node.expression.expression); definitions.set(symbol, entries); }
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(tree);
  const staticValues = (node, seen = new Set()) => {
    if (!node) return [];
    if (ts.isIdentifier(node)) {
      const symbol = binding(node);
      if (!symbol || seen.has(symbol)) return [];
      const next = new Set(seen).add(symbol);
      return (definitions.get(symbol) ?? []).flatMap((value) => staticValues(value, next));
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((value) => staticValues(value, seen));
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return staticValues(node.expression, seen);
    if (ts.isPropertyAccessExpression(node)) {
      return staticValues(node.expression, seen).flatMap((object) => ts.isObjectLiteralExpression(object)
        ? object.properties.filter((p) => ts.isPropertyAssignment(p) && p.name.getText(tree).replace(/^["']|["']$/g, "") === node.name.text).flatMap((p) => staticValues(p.initializer, seen)) : []);
    }
    return [node];
  };
  const containsCopy = (node, seen = new Set()) => {
    if (!node) return false;
    if (ts.isStringLiteralLike(node)) return !!node.text.trim();
    if (ts.isIdentifier(node)) {
      const symbol = binding(node);
      if (!symbol || seen.has(symbol)) return false;
      const next = new Set(seen).add(symbol);
      return (definitions.get(symbol) ?? []).some((value) => containsCopy(value, next));
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "t") return false;
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
        const callback = node.arguments[0];
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return containsCopy(callback.body, seen);
      }
      return node.arguments.some((arg) => containsCopy(arg, seen));
    }
    if (ts.isTemplateExpression(node)) return !!node.head.text.trim() || node.templateSpans.some((span) => !!span.literal.text.trim() || containsCopy(span.expression, seen));
    if (ts.isPropertyAccessExpression(node)) return staticValues(node, seen).some((value) => containsCopy(value, seen));
    if (ts.isElementAccessExpression(node)) return containsCopy(node.expression, seen);
    if (ts.isObjectLiteralExpression(node)) return node.properties.some((p) => ts.isPropertyAssignment(p) && containsCopy(p.initializer, seen));
    if (ts.isConditionalExpression(node)) return containsCopy(node.whenTrue, seen) || containsCopy(node.whenFalse, seen);
    if (ts.isBinaryExpression(node)) return containsCopy(node.left, seen) || containsCopy(node.right, seen);
    if (ts.isArrayLiteralExpression(node)) return node.elements.some((child) => containsCopy(child, seen));
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.some((child) => containsCopy(child, seen));
    if (ts.isJsxText(node)) return !!node.text.trim();
    if (ts.isJsxExpression(node)) return containsCopy(node.expression, seen);
    if (ts.isBlock(node)) return node.statements.some((statement) => ts.isReturnStatement(statement) && containsCopy(statement.expression, seen));
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return containsCopy(node.expression, seen);
    return false;
  };
  let translator = false;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === "useDt") report(node, "legacy useDt in migrated section");
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useT") {
      if (!ts.isIdentifier(node.name) || node.name.text !== "t") report(node, "use the named t binding for dictionary checks");
      else translator = true;
    }
    if (ts.isJsxText(node) && node.text.trim()) report(node, "raw JSX copy");
    if (ts.isJsxExpression(node) && node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && containsCopy(node.expression)) report(node, "raw expression copy");
    if (ts.isJsxAttribute(node) && textAttributes.has(node.name.getText(tree)) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (containsCopy(value)) report(node, "raw text attribute");
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const key = node.arguments[0];
      if (!key || !ts.isStringLiteralLike(key) || !keys.has(key.text)) report(node, "unknown or dynamic dictionary key");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (requireTranslator && !translator) errors.push(`${filename}: migrated section must retain useT`);
  return errors;
}

export function checkI18n(root = repository) {
  const app = path.join(root, "miniapp");
  const generated = generateCatalog(app, true), directory = path.join(app, "src/lib/i18n/locales");
  const catalog = Object.fromEntries(fs.readdirSync(directory).filter((n) => n.endsWith(".json")).map((n) => [n.slice(0, -5), parseDictionary(fs.readFileSync(path.join(directory, n), "utf8"), n)]));
  const keys = new Set(Object.keys(validateCatalog(catalog)));
  const registry = JSON.parse(fs.readFileSync(path.join(app, "scripts/i18n-migrated.json"), "utf8"));
  if (!Array.isArray(registry) || !registry.length || new Set(registry).size !== registry.length) throw new Error("i18n: invalid migrated-section registry");
  const files = new Set(registry);
  const legacy = JSON.parse(fs.readFileSync(path.join(app, "scripts/i18n-legacy-sections.json"), "utf8"));
  if (!Array.isArray(legacy) || new Set(legacy).size !== legacy.length || legacy.some((file) => typeof file !== "string" || !file.startsWith("src/components/") || file.includes(".."))) throw new Error("i18n: invalid legacy-section registry");
  const legacyFiles = new Set(legacy), required = new Set(registry);
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".tsx")) {
        const file = path.relative(app, target).split(path.sep).join("/");
        if (/\buseT\b/.test(fs.readFileSync(target, "utf8"))) { files.add(file); required.add(file); }
        else if (!legacyFiles.has(file)) files.add(file);
      }
    }
  }
  walk(path.join(app, "src/components"));
  const errors = [];
  for (const file of files) {
    if (typeof file !== "string" || !file.startsWith("src/components/") || file.includes("..") || !file.endsWith(".tsx")) throw new Error("i18n: invalid registered path");
    errors.push(...inspectSection(fs.readFileSync(path.join(app, file), "utf8"), file, keys, required.has(file)));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return { ...generated, sections: files.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkI18n())); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
