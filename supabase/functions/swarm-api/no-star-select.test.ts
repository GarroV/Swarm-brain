// Детектор дрифта на правило «select("*") по entries запрещён» (issue #102, канон —
// ARCHITECTURE §swarm-api). Правило нельзя закрыть обычным юнит-тестом: точек доступа много,
// и новая появляется в 2000-строчном роутере одной строкой.
//
// Почему это не педантизм: у entries есть embedding vector(1536) (~18.5 кБ текстом на строку)
// и fts tsvector (~7.8 кБ), которых нет ни в EntryRow, ни в клиентском Entry. Один забытый
// select("*") возвращает мегабайты балласта и НЕ ЛОМАЕТ НИ ОДНОГО теста — экран продолжает
// работать, просто медленно. Ровно так это и прожило до #102.
//
// Сканируем построчно, помня последнюю встреченную from("<таблица>"): в supabase-js цепочка
// бывает разорвана на десяток строк (.insert({...}) на 18 строк, а .select("*") в конце), и
// проверка «в пределах трёх строк» такие случаи пропускала — проверено, пропустила две.
import { assertEquals } from "jsr:@std/assert@1";

const FILES = ["index.ts", "entries-guard.ts", "admin.ts", "notifications.ts", "task-comments.ts", "task-labels.ts", "task-subscriptions.ts"];
const HERE = new URL(".", import.meta.url).pathname;

/** Строки со `.select("*")`, где текущая таблица цепочки — `table`. */
function starSelectsOn(src: string, table: string): number[] {
  const hits: number[] = [];
  let current: string | null = null;
  src.split("\n").forEach((line, i) => {
    // Последний from(...) в строке задаёт таблицу для последующих звеньев цепочки.
    const froms = [...line.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)];
    if (froms.length) current = froms[froms.length - 1][1];
    if (/\.select\(\s*["'`]\*["'`]/.test(line) && current === table) hits.push(i + 1);
    // Точка с запятой в конце строки без продолжения цепочки — конец выражения.
    if (/;\s*$/.test(line) && !/\.select\(\s*["'`]\*["'`]/.test(line)) current = null;
  });
  return hits;
}

Deno.test("в swarm-api нет select(\"*\") по таблице entries", async () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    let src: string;
    try { src = await Deno.readTextFile(HERE + f); } catch { continue; }
    const lines = src.split("\n");
    for (const ln of starSelectsOn(src, "entries")) offenders.push(`${f}:${ln}  ${lines[ln - 1].trim()}`);
  }
  assertEquals(
    offenders, [],
    `select("*") по entries запрещён (issue #102) — используйте ENTRY_COLUMNS:\n${offenders.join("\n")}`,
  );
});

Deno.test("детектор ловит разорванную цепочку — иначе он бесполезен", () => {
  const sample = [
    'const { data } = await supabase.from("entries").insert({',
    '  content: draft,',
    '  summary: draft,',
    '}).select("*").single();',
  ].join("\n");
  assertEquals(starSelectsOn(sample, "entries"), [4]);
});

Deno.test("детектор не срабатывает на другие таблицы", () => {
  const sample = 'const { data } = await supabase.from("workspaces").select("*").eq("id", w).single();';
  assertEquals(starSelectsOn(sample, "entries"), []);
});
