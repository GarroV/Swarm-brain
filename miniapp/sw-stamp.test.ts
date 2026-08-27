// Раннер тот же, что у sw.test.ts и edge-функций: deno test -A miniapp/sw-stamp.test.ts
//
// Правило, которое здесь закреплено: КАЖДАЯ сборка с изменившимся бандлом обязана давать
// НОВЫЙ sw.js. Иначе открытая вкладка не перезагрузится (controllerchange не сработает) и
// человек продолжит работать на прежнем коде — раскатка до него просто не доедет.
import { assertEquals, assertNotEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fingerprintDir, stampServiceWorker } from "./scripts/sw-stamp.mjs";

const SW = `// комментарий\nconst CACHE = "roj-static-v32";  // v32: пояснение\nconst PRECACHE = ["/"];\n`;

Deno.test("отпечаток попадает в имя кэша, ручная версия сохраняется", () => {
  const out = stampServiceWorker(SW, "abc123def456");
  assertEquals(out.includes(`const CACHE = "roj-static-v32-abc123def456"`), true);
  assertEquals(out.includes("// v32: пояснение"), true);
});

Deno.test("разный отпечаток даёт РАЗНЫЙ sw.js — только так вкладка узнает об обновлении", () => {
  assertNotEquals(stampServiceWorker(SW, "aaaaaaaaaaaa"), stampServiceWorker(SW, "bbbbbbbbbbbb"));
});

Deno.test("тот же отпечаток даёт ТОТ ЖЕ sw.js — пересборка без изменений не дёргает людей", () => {
  assertEquals(stampServiceWorker(SW, "aaaaaaaaaaaa"), stampServiceWorker(SW, "aaaaaaaaaaaa"));
});

Deno.test("повторная штамповка заменяет отпечаток, а не приклеивает второй", () => {
  const once = stampServiceWorker(SW, "aaaaaaaaaaaa");
  const twice = stampServiceWorker(once, "bbbbbbbbbbbb");
  assertEquals(twice.includes(`const CACHE = "roj-static-v32-bbbbbbbbbbbb"`), true);
  assertEquals(twice.includes("aaaaaaaaaaaa"), false);
});

Deno.test("пропавшая строка CACHE — громкая ошибка сборки, а не тихо непроштампованный файл", () => {
  assertThrows(() => stampServiceWorker('const OTHER = "x";', "abc123def456"));
});

// ── отпечаток дерева ──────────────────────────────────────────────────────────

function fakeTree(files: Record<string, string>) {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const readDir = (d: string) => {
    const prefix = d === "root" ? "" : `${d.slice(5)}/`;
    const names = new Set<string>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      names.add(path.slice(prefix.length).split("/")[0]);
    }
    return [...names];
  };
  const isDir = (p: string) => dirs.has(p.slice(5));
  return {
    readDir,
    stat: (p: string) => ({ isDirectory: () => isDir(p) }),
    readFile: (p: string) => files[p.slice(5)],
  };
}

Deno.test("изменение СОДЕРЖИМОГО файла меняет отпечаток", () => {
  const a = fakeTree({ "chunks/app.js": "старый код" });
  const b = fakeTree({ "chunks/app.js": "новый код" });
  assertNotEquals(
    fingerprintDir("root", a.readFile, a.readDir, a.stat),
    fingerprintDir("root", b.readFile, b.readDir, b.stat),
  );
});

Deno.test("изменение ИМЕНИ файла меняет отпечаток", () => {
  const a = fakeTree({ "chunks/one.js": "код" });
  const b = fakeTree({ "chunks/two.js": "код" });
  assertNotEquals(
    fingerprintDir("root", a.readFile, a.readDir, a.stat),
    fingerprintDir("root", b.readFile, b.readDir, b.stat),
  );
});

Deno.test("одинаковое дерево даёт одинаковый отпечаток независимо от порядка обхода", () => {
  const a = fakeTree({ "chunks/b.js": "2", "chunks/a.js": "1" });
  const b = fakeTree({ "chunks/a.js": "1", "chunks/b.js": "2" });
  assertEquals(
    fingerprintDir("root", a.readFile, a.readDir, a.stat),
    fingerprintDir("root", b.readFile, b.readDir, b.stat),
  );
});
