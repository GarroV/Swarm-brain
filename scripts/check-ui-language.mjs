// Narrow AST guard for literal UI Cyrillic (#735). No translation or product changes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../miniapp/package.json", import.meta.url),
);
const ts = require("typescript");
const cyrillic = /\p{Script=Cyrillic}/u;
const attributes = new Set(["title", "aria-label", "placeholder"]);

function translated(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isCallExpression(p) && ts.isIdentifier(p.expression) &&
      ["dt", "tx"].includes(p.expression.text)
    ) return true;
  }
  return false;
}

function surface(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) {
      return attributes.has(p.name.text) ? p.name.text : null;
    }
    if (ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent)) {
      return "children";
    }
  }
  return null;
}

export function scan(source, file = "fixture.tsx") {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (ast.parseDiagnostics.length) {
    throw new Error(
      `${file}: ${
        ts.flattenDiagnosticMessageText(
          ast.parseDiagnostics[0].messageText,
          " ",
        )
      }`,
    );
  }
  const found = [];
  function visit(node) {
    const jsxText = ts.isJsxText(node);
    const literal = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (
      (jsxText || literal) && cyrillic.test(node.text) &&
      !ts.isLiteralTypeNode(node.parent) && !translated(node)
    ) {
      const context = jsxText ? "jsx-text" : surface(node);
      if (context) {
        const text = node.text.trim().replace(/\s+/g, " ");
        const { line, character } = ast.getLineAndCharacterOfPosition(
          node.getStart(ast),
        );
        found.push({
          file,
          context,
          text,
          line: line + 1,
          column: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

export function inventory(
  directory = path.join(root, "miniapp/src/components"),
) {
  const findings = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
        findings.push(
          ...scan(
            fs.readFileSync(file, "utf8"),
            path.relative(root, file).split(path.sep).join("/"),
          ),
        );
      }
    }
  }
  walk(directory);
  return findings;
}

const keyOf = ({ file, context, text }) =>
  JSON.stringify([file, context, text]);

export function compare(findings, baseline) {
  const allowed = new Map();
  for (const item of baseline) {
    if (
      !item.reason?.trim() || !Number.isInteger(item.count) || item.count < 1 ||
      allowed.has(keyOf(item))
    ) {
      throw new Error("Invalid or duplicate UI language baseline entry");
    }
    allowed.set(keyOf(item), item.count);
  }
  const used = new Map();
  const unexpected = findings.filter((item) => {
    const key = keyOf(item), count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    return count > (allowed.get(key) ?? 0);
  });
  const stale = baseline.filter((item) =>
    (used.get(keyOf(item)) ?? 0) < item.count
  );
  return { unexpected, stale };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const found = inventory();
    if (process.argv.includes("--measure")) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      const baseline = JSON.parse(
        fs.readFileSync(
          path.join(root, "scripts/ui-language-baseline.json"),
          "utf8",
        ),
      );
      const { unexpected, stale } = compare(found, baseline);
      for (const item of unexpected) {
        console.error(
          `${item.file}:${item.line}:${item.column} ${item.context}: ${item.text}`,
        );
      }
      for (const item of stale) {
        console.error(
          `Remove stale baseline: ${item.file} ${item.context}: ${item.text}`,
        );
      }
      console.log(
        `UI language: ${found.length} literals, ${unexpected.length} new, ${stale.length} stale`,
      );
      process.exitCode = unexpected.length || stale.length ? 1 : 0;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
