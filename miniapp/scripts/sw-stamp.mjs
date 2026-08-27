// Штамповка service worker отпечатком сборки.
//
// Зачем. Открытую вкладку перезагружает ТОЛЬКО `controllerchange` (ServiceWorkerRegister.tsx),
// а он срабатывает лишь когда встаёт НОВЫЙ service worker — то есть когда изменился сам файл
// sw.js. Раскатка, не тронувшая sw.js, до открытых вкладок не доезжает вообще: человек
// продолжает работать на прежнем бандле, пока не перезагрузит страницу руками.
//
// Поймано на живом примере 2026-08-28: потоковый разбор задач уехал на прод, владелец у
// открытой с вечера вкладки видел ровно прежнее поведение и сказал «появляется очень долго».
// При этом в решении о плашке обновления записано «service worker сам перезагружает открытые
// страницы» — верно только когда sw.js случайно изменился.
//
// Отпечаток — хеш ИМЁН и СОДЕРЖИМОГО собранной статики, а не время сборки и не номер коммита:
// пересборка без изменений даёт тот же отпечаток, sw.js не меняется, и людям не прилетает
// перезагрузка на ровном месте. Изменился бандл — изменился отпечаток — вкладки обновятся.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Отпечаток дерева файлов: путь + содержимое каждого, в стабильном порядке.
 * Доступ к диску инжектируется, чтобы правило проверялось тестом на фальшивом дереве,
 * а не реальной сборкой.
 * @param {string} dir
 * @param {(path: string) => string | Uint8Array} [readFile]
 * @param {(path: string) => string[]} [readDir]
 * @param {(path: string) => { isDirectory(): boolean }} [stat]
 * @returns {string}
 */
export function fingerprintDir(dir, readFile = readFileSync, readDir = readdirSync, stat = statSync) {
  const hash = createHash("sha256");
  const walk = (current, prefix) => {
    for (const name of [...readDir(current)].sort()) {
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (stat(full).isDirectory()) walk(full, rel);
      else {
        hash.update(rel);
        hash.update(readFile(full));
      }
    }
  };
  walk(dir, "");
  return hash.digest("hex").slice(0, 12);
}

/**
 * Подставить отпечаток в имя кэша. Ручная версия (`v32`) сохраняется: она несёт смысл
 * «схема кэша поменялась, чистим старое», а отпечаток — «бандл другой, перезагрузись».
 * Идемпотентно: повторный прогон по уже проштампованному файлу заменяет отпечаток, а не
 * приклеивает второй.
 */
export function stampServiceWorker(source, fingerprint) {
  const re = /const CACHE = "(roj-static-v\d+)(?:-[0-9a-f]+)?"/;
  if (!re.test(source)) throw new Error("sw.js: не найдена строка const CACHE — штамповка невозможна");
  return source.replace(re, (_m, base) => `const CACHE = "${base}-${fingerprint}"`);
}

// ── запуск из сборки ──────────────────────────────────────────────────────────
// Вызывается только как скрипт; при импорте в тесте ничего не делает.
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? "out";
  const fingerprint = fingerprintDir(join(outDir, "_next", "static"));
  const swPath = join(outDir, "sw.js");
  const stamped = stampServiceWorker(readFileSync(swPath, "utf8"), fingerprint);
  writeFileSync(swPath, stamped, "utf8");
  console.log(`✅ out/sw.js проштампован отпечатком сборки ${fingerprint} — открытые вкладки обновятся`);
}
