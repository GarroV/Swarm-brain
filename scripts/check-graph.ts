// Мёртвый код и границы модулей для доски инициатив.
// Готового инструмента под Deno нет (admissio/references/deno.md), а dependency-cruiser
// молча пропускает URL-импорты и даёт ложное «нарушений нет». Поэтому свой разбор импортов.
//
// Границы выводятся из графа блоков техплана: блок импортирует только то, от чего зависит.
// Обратное направление запрещено — именно его не видно внутри одной рабочей копии.
const FORBIDDEN: { from: RegExp; to: RegExp; why: string }[] = [
  {
    from: /^supabase\/functions\/_shared\//,
    to: /^supabase\/functions\/swarm-(api|bot|mcp)\//,
    why: "ядро не зависит от сервисов: общий модуль тянул бы за собой роуты",
  },
  {
    from: /^miniapp\/src\/lib\//,
    to: /^miniapp\/src\/components\//,
    why: "чистая логика не зависит от экранов — иначе её нельзя тестировать без DOM",
  },
  {
    from: /^supabase\/functions\//,
    to: /^miniapp\//,
    why: "сервер не зависит от веба",
  },
];

const ROOTS = ["supabase/functions", "miniapp/src", "miniapp/sw.test.ts"];
const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (["node_modules", ".next", "out", "reports"].includes(e.name)) continue;
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

const files: string[] = [];
for (const root of ROOTS) {
  const st = await Deno.stat(root).catch(() => null);
  if (!st) continue;
  if (st.isFile) files.push(root);
  else for await (const f of walk(root)) files.push(f);
}

const norm = (from: string, spec: string): string | null => {
  if (spec.startsWith("@/")) return `miniapp/src/${spec.slice(2)}`;
  if (!spec.startsWith(".")) return null; // внешние и URL-импорты границ не нарушают
  const base = from.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
};

const imported = new Set<string>();
const violations: string[] = [];

for (const file of files) {
  const src = await Deno.readTextFile(file);
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = norm(file, m[1]);
    if (!target) continue;
    for (const cand of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
      if (files.includes(cand)) imported.add(cand);
    }
    for (const rule of FORBIDDEN) {
      if (rule.from.test(file) && rule.to.test(target)) {
        violations.push(`${file} → ${m[1]} (${rule.why})`);
      }
    }
  }
}

// Мёртвый код — только среди файлов фичи: остальной репозиторий эта стройка не чинит.
const feature = (await Deno.readTextFile("scripts/feature-paths.txt"))
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const isFeature = (f: string) => feature.some((p) => f === p || f.startsWith(`${p}/`));
const isEntry = (f: string) => /index\.ts$/.test(f) || /\.test\.tsx?$/.test(f) ||
  /^miniapp\/src\/app\//.test(f);

const dead = files.filter((f) => isFeature(f) && !isEntry(f) && !imported.has(f));

console.log(
  dead.length ? `мёртвый код: ${dead.length} — ${dead.join(", ")}` : "мёртвый код: не найден",
);
console.log(
  violations.length
    ? `границы: ${violations.length} нарушений — ${violations.join("; ")}`
    : "границы: нарушений нет",
);
Deno.exit(dead.length + violations.length > 0 ? 1 : 0);
