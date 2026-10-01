// Сторож путей от `import.meta.url` (#469, #504, #524, #559, #642): `.pathname` у file-URL
// отдаёт путь в percent-кодировке, и в рабочей копии с кириллицей в имени папки
// (`…/Swarm-brain/Мелкие-правки`) `Deno.readTextFile`/`readDir` получают `%D0%9C…` и падают
// `NotFound`. В CI путь латинский, поэтому поломка видна только локально и выглядит как
// регрессия в коде. Задача заводилась четыре раза — правило в доке не держит, держит прогон.
//
// Канон — `fromFileUrl(new URL(…, import.meta.url))` из std/path или сам объект `URL`
// (`Deno.readTextFile` его принимает). `decodeURIComponent(… .pathname)` тоже под запретом:
// одна форма на весь репозиторий, чтобы сторожу не приходилось различать «правильный» pathname.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const REPO = fromFileUrl(new URL("../../../", import.meta.url));
/** Сам сторож держит запрещённую форму в примерах — его не сканируем. */
const SELF = fromFileUrl(import.meta.url);
/** Где лежит код с `import.meta.url`: функции, скрипты, веб, бот, файловый сервис. */
const DIRS = ["supabase", "scripts", "miniapp", "bot", "files"];
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", "coverage", ".git"]);
const EXT = /\.(ts|tsx|mts|js|mjs)$/;
/** `import.meta.url)` и затем `.pathname` — в том числе через перенос строки. */
const BAD = /import\.meta\.url\s*\)\s*\.pathname/g;

async function* sources(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory) yield* sources(p);
    else if (e.isFile && EXT.test(e.name) && p !== SELF) yield p;
  }
}

/** Номера строк, где в тексте встречается запрещённая форма. */
function badLines(text: string): number[] {
  return [...text.matchAll(BAD)].map((m) => text.slice(0, m.index).split("\n").length);
}

Deno.test("сторож путей: ловит .pathname от import.meta.url, в том числе через перенос и обёртку", () => {
  assertEquals(badLines('const a = new URL(".", import.meta.url).pathname;'), [1]);
  assertEquals(badLines('x\nconst a = decodeURIComponent(new URL("../", import.meta.url).pathname);'), [2]);
  assertEquals(badLines('f(\n  new URL("a.ts", import.meta.url)\n    .pathname,\n);'), [2]);
  assertEquals(badLines('const a = fromFileUrl(new URL(".", import.meta.url));'), []);
  assertEquals(badLines("if (url.pathname === '/token') {}"), []);
});

Deno.test("путь от import.meta.url берётся через fromFileUrl, а не .pathname", async () => {
  const hits: string[] = [];
  let scanned = 0;
  for (const d of DIRS) {
    for await (const file of sources(join(REPO, d))) {
      scanned++;
      const text = await Deno.readTextFile(file);
      for (const line of badLines(text)) hits.push(`${relative(REPO, file)}:${line}`);
    }
  }
  // Пустой обход — не зелёный: сторож, не нашедший ни одного файла, ничего не проверил.
  assert(scanned > 100, `сторож обошёл всего ${scanned} файлов из ${REPO} — путь к репозиторию сломан?`);
  assertEquals(
    hits,
    [],
    `.pathname от import.meta.url ломается в папке с не-ASCII именем (percent-кодировка). ` +
      `Замени на fromFileUrl(new URL(…, import.meta.url)) из std/path:\n  ${hits.join("\n  ")}`,
  );
});
