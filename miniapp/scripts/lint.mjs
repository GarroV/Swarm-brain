#!/usr/bin/env node
// Existing debt is explicit; normal runs never write or expand its allowances.
import { ESLint } from "eslint";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = new URL("../eslint-baseline.json", import.meta.url);
const reportPath = new URL("../../reports/miniapp-lint.json", import.meta.url);
const key = (entry) => JSON.stringify([entry.file, entry.rule, entry.message]);

function findings(results) {
  const counts = new Map();
  for (const result of results) {
    if (result.fatalErrorCount) throw new Error("eslint_fatal_diagnostic");
    for (const message of result.messages) {
      if (!message.ruleId || message.fatal) throw new Error("unclassified_diagnostic");
      // React compiler messages include absolute paths/code frames after the first paragraph.
      const entry = {
        file: path.relative(root, result.filePath).split(path.sep).join("/"),
        rule: message.ruleId,
        message: message.message.split("\n\n")[0],
      };
      const id = key(entry);
      const old = counts.get(id);
      counts.set(id, { ...entry, count: (old?.count ?? 0) + 1 });
    }
  }
  return counts;
}

function allowances(rows) {
  if (!Array.isArray(rows)) throw new Error("invalid_baseline");
  const counts = new Map();
  for (const row of rows) {
    if (Object.keys(row).sort().join() !== "count,file,message,rule" ||
        ![row.file, row.rule, row.message].every((v) => typeof v === "string" && v.length > 0) ||
        row.file.startsWith("/") || row.file.split("/").includes("..") ||
        !Number.isSafeInteger(row.count) || row.count < 1 || counts.has(key(row))) {
      throw new Error("invalid_baseline");
    }
    counts.set(key(row), row);
  }
  return counts;
}

function regressions(current, baseline) {
  return [...current].filter(([id, row]) => row.count > (baseline.get(id)?.count ?? 0))
    .map(([id, row]) => ({ ...row, allowed: baseline.get(id)?.count ?? 0 }));
}

async function porcha(eslint) {
  if (allowances([]).size !== 0) throw new Error("empty_baseline_rejected");
  const probe = path.join(root, "src", `lint-negative-${process.pid}.tsx`);
  try {
    // Actual ESLint must reject both the unused import and Next's async-client contract.
    await writeFile(probe, '"use client";\nimport { useState } from "react";\nexport default async function Probe() { return <div />; }\n', { flag: "wx" });
    const bad = findings(await eslint.lintFiles([probe]));
    const rules = new Set([...bad.values()].map((row) => row.rule));
    if (!rules.has("@typescript-eslint/no-unused-vars") || !rules.has("@next/next/no-async-client-component") ||
        regressions(bad, new Map()).length < 2) throw new Error("porcha_not_detected");
    // Measure a real repeated diagnostic against a budget of one, not a synthetic result.
    await writeFile(probe, "export function one() { const prior = 1; return 0; }\nexport function two() { const prior = 2; return 0; }\n");
    const repeated = findings(await eslint.lintFiles([probe]));
    const row = [...repeated.values()].find((item) => item.rule === "@typescript-eslint/no-unused-vars" && item.message.startsWith("'prior'"));
    if (!row || row.count !== 2 || regressions(repeated, new Map([[key(row), { ...row, count: 1 }]])).length !== 1) {
      throw new Error("porcha_growth_not_detected");
    }
    console.log("miniapp lint porcha: unused import, async client and existing-budget growth rejected");
  } finally {
    await rm(probe, { force: true });
  }
}

try {
  const eslint = new ESLint({ cwd: root });
  if (process.argv.slice(2).join() === "--porcha") {
    await porcha(eslint);
  } else {
    if (process.argv.length !== 2) throw new Error("unsupported_arguments");
    const baseline = allowances(JSON.parse(await readFile(baselinePath, "utf8")));
    // Missing/empty inputs, parser/config/plugin failures throw; they cannot match baseline debt.
    const results = await eslint.lintFiles(["."]);
    if (!results.length) throw new Error("no_files_checked");
    const current = findings(results);
    const added = regressions(current, baseline);
    const report = {
      status: added.length ? "FAIL" : "PASS",
      filesChecked: results.length,
      existingDiagnostics: [...current.values()].reduce((sum, row) => sum + row.count, 0),
      regressions: added,
      resolved: [...baseline].filter(([id, row]) => (current.get(id)?.count ?? 0) < row.count).map(([, row]) => row),
    };
    await mkdir(path.dirname(fileURLToPath(reportPath)), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`miniapp lint: ${report.status}, ${report.filesChecked} files, ${report.existingDiagnostics} existing diagnostics, ${added.length} regressions`);
    for (const row of added) console.error(`${row.file}: ${row.rule}: ${row.message} (${row.count} > ${row.allowed})`);
    if (added.length) process.exitCode = 1;
  }
} catch (error) {
  // Do not leave an old PASS report behind after a config/parser failure.
  try {
    await mkdir(path.dirname(fileURLToPath(reportPath)), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ status: "FAIL", errorType: "tool_or_config_failure" }) + "\n");
  } catch { /* The nonzero exit still reports an unwritable report directory. */ }
  // Config/parse/tool failures are never converted into baseline allowances.
  console.error(`miniapp lint: FAIL (${error instanceof Error ? error.message : "unknown_error"})`);
  process.exitCode = 1;
}
