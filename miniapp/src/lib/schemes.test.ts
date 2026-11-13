// Цветовые схемы оформления (docs/decisions/2026-11-12-color-themes.md): что CSS схем целен и что
// текст на своём фоне читается (WCAG AA, 4,5 : 1) в КАЖДОЙ схеме и КАЖДОМ её режиме — считается из
// самого app/schemes.css, а не из таблиц в документе. Схема «Swarm» в контраст не входит: её светлый
// --ink-mute даёт 3,14 : 1 (issue #1285), это отдельное решение; её блок проверяется только на
// совпадение с globals.css (плитка в меню рисуется из него).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { forcedMode, SCHEME_IDS, SCHEME_OPTIONS, schemeThemeScript } from "./scheme.ts";

const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));
const SCHEMES_CSS = read("../app/schemes.css") + "\n" + read("../app/schemes-2.css"); // файл разрезан по лимиту размера
const GLOBALS_CSS = read("../app/globals.css");
const ME_FIELDS = read("../../../supabase/functions/swarm-api/me-fields.ts");

/** selector → { --var: value } для плоских блоков `selector { … }` (без вложенности — её в файлах нет). */
function parseBlocks(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    const vars = blocks.get(selector) ?? new Map<string, string>();
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(d[1], d[2].trim());
    blocks.set(selector, vars);
  }
  return blocks;
}

const schemes = parseBlocks(SCHEMES_CSS);
const globals = parseBlocks(GLOBALS_CSS);

/** Значение переменной с раскрытием var(--x) внутри того же блока. */
function resolve(vars: Map<string, string>, name: string, depth = 0): string {
  const v = vars.get(name);
  if (v === undefined) throw new Error(`нет переменной ${name}`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return v;
  if (depth > 8) throw new Error(`цикл в ${name}`);
  return resolve(vars, ref[1], depth + 1);
}

type Mode = "light" | "dark";
/** Блок схемы для режима: двухрежимная — [data-scheme] / .dark[data-scheme]; однорежимная — один [data-scheme]. */
function modeBlock(id: string, mode: Mode): Map<string, string> {
  const single = forcedMode(id as never);
  const selector = single ? `[data-scheme="${id}"]` : mode === "dark" ? `.dark[data-scheme="${id}"]` : `[data-scheme="${id}"]`;
  const b = schemes.get(selector);
  if (!b) throw new Error(`в schemes.css нет блока ${selector}`);
  return b;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Пары «текст на фоне», встречающиеся на экранах: первые 13 — из таблицы утверждённого макета
// (tokens.md), дальше — пары, которые появились при переводе жёстких цветов на токены.
const PAIRS: [string, string, string][] = [
  ["--ink", "--background", "текст на фоне"],
  ["--ink", "--surface", "текст на карточке"],
  ["--ink-soft", "--surface", "вторичный текст на карточке"],
  ["--ink-soft", "--sidebar", "пункты рейки"],
  ["--ink-mute", "--surface", "приглушённый текст на карточке"],
  ["--ink-mute", "--background", "приглушённый текст на фоне"],
  ["--primary-foreground", "--primary", "подпись на главной кнопке"],
  ["--accent-ink", "--accent-soft", "активный пункт рейки, ссылки-плашки"],
  ["--accent-ink", "--surface", "ссылки «Все …» на карточке"],
  ["--pri-high", "--surface", "просрочено / проблема"],
  ["--pri-med", "--surface", "риск, «сегодня»"],
  ["--status-done", "--surface", "готово, рост"],
  ["--tag-mic", "--surface", "метка встречи / тег"],
  ["--ink", "--surface-2", "текст на втором плане (поля, пилюли)"],
  ["--ink-soft", "--surface-2", "вторичный текст на втором плане"],
  ["--on-solid", "--pri-high", "значок на красной заливке"],
  ["--on-solid", "--status-done", "галочка на зелёной заливке"],
  ["--on-solid", "--pri-med", "подпись на янтарной заливке"],
  ["--on-solid", "--accent-ink", "подпись на заливке акцента"],
  ["--on-primary", "--primary", "подпись на заливке главного цвета"],
];
const AA = 4.5;

for (const opt of SCHEME_OPTIONS) {
  if (opt.id === "swarm") continue;
  for (const mode of opt.modes) {
    Deno.test(`контраст: схема «${opt.id}», ${mode}: все пары не ниже ${AA} : 1`, () => {
      const vars = modeBlock(opt.id, mode);
      const bad: string[] = [];
      for (const [fg, bg, what] of PAIRS) {
        const ratio = contrast(resolve(vars, fg), resolve(vars, bg));
        if (ratio < AA) bad.push(`${what}: ${fg} на ${bg} = ${ratio.toFixed(2)} (${resolve(vars, fg)} на ${resolve(vars, bg)})`);
      }
      assertEquals(bad, [], `схема ${opt.id}/${mode} — ниже ${AA} : 1:\n  ${bad.join("\n  ")}`);
    });
  }
}

Deno.test("схемы: у каждой схемы и режима переопределены ВСЕ переменные Swarm — иначе чужой цвет протечёт", () => {
  const swarmVars = new Set<string>();
  for (const sel of [":root", ".dark"]) for (const k of globals.get(sel)?.keys() ?? []) swarmVars.add(k);
  // Затемнение и тени нейтральны и одинаковы во всех схемах; --radius у схемы один на оба режима (светлый блок).
  const common = new Set(["--radius", "--scrim", "--scrim-sheet", "--scrim-faint", "--scrim-dialog", "--scrim-drawer", "--shadow-dialog"]);
  const missing: string[] = [];
  for (const opt of SCHEME_OPTIONS) {
    if (opt.id === "swarm") continue;
    for (const mode of opt.modes) {
      const vars = modeBlock(opt.id, mode);
      for (const v of swarmVars) if (!common.has(v) && !vars.has(v)) missing.push(`${opt.id}/${mode}: нет ${v}`);
    }
  }
  assertEquals(missing, []);
});

Deno.test("схемы: блоки schemes.css есть ровно для схем из lib/scheme.ts, режимы совпадают", () => {
  const selectors = [...schemes.keys()].filter((s) => s.includes("data-scheme"));
  const ids = new Set(selectors.map((s) => s.match(/data-scheme="([\w]+)"/)![1]));
  assertEquals([...ids].sort(), [...SCHEME_IDS].sort());
  for (const opt of SCHEME_OPTIONS) {
    if (opt.id === "swarm") continue;
    const hasDark = schemes.has(`.dark[data-scheme="${opt.id}"]`);
    assertEquals(hasDark, opt.modes.length === 2, `${opt.id}: тёмный блок только у двухрежимных схем`);
  }
});

Deno.test("схемы: блок «своя картинка» есть у каждой схемы и режима (иначе стекло возьмёт цвета Swarm)", () => {
  const need = ["--backdrop-dim", "--glass-pane", "--glass-rail", "--background", "--surface", "--surface-2", "--card", "--popover", "--line", "--ink-mute"];
  for (const opt of SCHEME_OPTIONS) {
    if (opt.id === "swarm") continue;
    for (const mode of opt.modes) {
      const sel = mode === "dark" && opt.modes.length === 2
        ? `html.dark[data-scheme="${opt.id}"][data-backdrop="custom"]`
        : `html[data-scheme="${opt.id}"][data-backdrop="custom"]`;
      const b = schemes.get(sel);
      assert(b, `нет блока ${sel}`);
      for (const v of need) assert(b.has(v), `${sel}: нет ${v}`);
    }
  }
});

Deno.test("схема «Swarm» в schemes.css — копия :root и .dark из globals.css (превью плитки не врёт)", () => {
  for (const [sel, src] of [[`[data-scheme="swarm"]`, ":root"], [`.dark[data-scheme="swarm"]`, ".dark"]] as const) {
    const copy = schemes.get(sel);
    assert(copy, `нет блока ${sel}`);
    for (const [k, v] of globals.get(src)!) assertEquals(copy.get(k), v, `${sel} ${k} расходится с globals.css ${src}`);
  }
});

Deno.test("схемы: список в me-fields.ts (PATCH /me) совпадает со списком веба", () => {
  const m = ME_FIELDS.match(/UI_SCHEMES: readonly string\[\] = \[([\s\S]*?)\];/);
  assert(m, "в me-fields.ts нет UI_SCHEMES");
  const server = [...m[1].matchAll(/"([\w]+)"/g)].map((x) => x[1]);
  assertEquals(server, [...SCHEME_IDS]);
});

Deno.test("схемы: у каждой схемы шрифты — переменные, объявленные в layout.tsx", () => {
  const layout = read("../app/layout.tsx");
  const declared = new Set([...layout.matchAll(/variable: "(--f-[\w-]+)"/g)].map((m) => m[1]));
  const used = new Set([...SCHEMES_CSS.matchAll(/var\((--f-[\w-]+)\)/g)].map((m) => m[1]));
  assert(used.size > 0);
  for (const v of used) assert(declared.has(v), `${v} используется в schemes.css, но не объявлен в layout.tsx`);
});

Deno.test("скрипт первой отрисовки: схема с одним режимом навязывает его, без выбора — как в системе", () => {
  const script = schemeThemeScript("swarm-theme");
  const run = (stored: Record<string, string>, systemDark: boolean) => {
    const cls = new Set<string>();
    const dataset: Record<string, string> = {};
    const doc = { documentElement: { dataset, classList: { toggle: (c: string, on: boolean) => on ? cls.add(c) : cls.delete(c) } } };
    // defineProperty: у Deno localStorage — встроенный аксессор, обычное присваивание его не заменит.
    const g = globalThis as Record<string, unknown>;
    const names = ["document", "localStorage", "matchMedia"] as const;
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(g, n));
    const set = (n: string, value: unknown) => Object.defineProperty(g, n, { value, configurable: true, writable: true });
    set("document", doc);
    set("localStorage", { getItem: (k: string) => stored[k] ?? null });
    set("matchMedia", () => ({ matches: systemDark, addEventListener: () => {} }));
    try {
      new Function(script)();
    } finally {
      names.forEach((n, i) => {
        if (saved[i]) Object.defineProperty(g, n, saved[i]!);
        else delete g[n];
      });
    }
    return { dark: cls.has("dark"), scheme: dataset.scheme };
  };
  assertEquals(run({}, false), { dark: false, scheme: undefined });
  assertEquals(run({}, true), { dark: true, scheme: undefined });
  assertEquals(run({ "swarm-scheme": "nuar", "swarm-theme": "light" }, true), { dark: false, scheme: "nuar" });
  assertEquals(run({ "swarm-scheme": "nuar" }, true), { dark: true, scheme: "nuar" });
  assertEquals(run({ "swarm-scheme": "terminal", "swarm-theme": "light" }, false), { dark: true, scheme: "terminal" });
  assertEquals(run({ "swarm-scheme": "slivki", "swarm-theme": "dark" }, true), { dark: false, scheme: "slivki" });
  assertEquals(run({ "swarm-scheme": "bogus" }, false), { dark: false, scheme: undefined });
});
