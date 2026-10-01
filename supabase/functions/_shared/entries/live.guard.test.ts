// Сторож «живой записи» (#569): каждая ЧИТАЮЩАЯ выборка из `entries` в коде функций обязана
// отсечь архив — обернуться в `onlyLiveEntries(...)`, фильтровать `archived_at` сама или нести
// рядом пометку `// archive-ok: <почему>` (запись по id сразу после вставки, откат, уборка).
// Физическое `.delete()` записи — тоже нарушение без пометки: запись теперь архивируется
// (`archive.ts`), удаляется только откат только что вставленной строки.
//
// Зачем тест, а не правило в доке: у задач правило в доке было, и его всё равно пропустили бот,
// напоминания и спринты (#575). Новый читатель без фильтра валит прогон, а не тащит архив людям.
import { assertEquals } from "@std/assert";
import { onlyLiveEntries } from "./live.ts";
import { fromFileUrl, join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
/** `.from("entries")` в любых кавычках и с любыми пробелами внутри скобок. */
const NEEDLE = /\.from\(\s*["'`]entries["'`]\s*\)/g;
/** Сколько символов после `.from("entries")` считаем одной цепочкой запроса. */
const WINDOW = 600;
/** Сколько строк над выборкой ищем пометку-исключение. */
const MARK_LINES = 3;

async function* sources(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      if (e.name === "node_modules") continue;
      yield* sources(p);
    } else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) {
      yield p;
    }
  }
}

/** Цепочка запроса: от `.from("entries")` до конца выражения (`;`), не дальше окна. */
function chainAfter(text: string, at: number): string {
  const rest = text.slice(at, at + WINDOW);
  const end = rest.indexOf(";");
  return end === -1 ? rest : rest.slice(0, end);
}

/** Первая операция цепочки: select / update / insert / upsert / delete. */
function firstOp(chain: string): string | undefined {
  return chain.match(/\.(select|update|insert|upsert|delete)\(/)?.[1];
}

/** Нарушения в одном исходнике (номера строк) — экспортировано для проверки самого сторожа. */
export function violations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NEEDLE)) {
    const at = m.index ?? 0;
    const chain = chainAfter(text, at);
    const op = firstOp(chain);
    const lineNo = text.slice(0, at).split("\n").length;
    const before = text.slice(0, at).split("\n").slice(-1 - MARK_LINES).join("\n");
    const marked = before.includes("archive-ok:");
    const wrapped = /onlyLiveEntries\(\s*[\w.]*\s*$/.test(text.slice(Math.max(0, at - 80), at));
    const ok = op === "delete" ? marked : op !== "select" || chain.includes("archived_at") || wrapped || marked;
    if (!ok) out.push(lineNo);
  }
  return out;
}

Deno.test("сторож ловит выборку записей без фильтра архива", () => {
  assertEquals(violations('const { data } = await supabase.from("entries").select("id").eq("x", 1);'), [1]);
  assertEquals(violations("await db.from( 'entries' ).select('id');"), [1], "другие кавычки и пробелы");
  assertEquals(violations('await onlyLiveEntries(supabase.from("entries").select("id")).eq("x", 1);'), []);
  assertEquals(violations('await onlyLiveEntries(\n  supabase\n    .from("entries")\n    .select("id"),\n);'), []);
  assertEquals(violations('await supabase.from("entries").select("id").is("archived_at", null);'), []);
  assertEquals(violations('// archive-ok: откат\nawait supabase.from("entries").select("id");'), []);
  assertEquals(violations('await supabase.from("entries").update({ a: 1 }).eq("id", x);'), []);
  assertEquals(violations('await supabase.from("entries").insert({ a: 1 }).select("id");'), []);
});

Deno.test("сторож ловит физическое удаление записи без пометки", () => {
  assertEquals(violations('await supabase.from("entries").delete().eq("id", x);'), [1]);
  assertEquals(violations('await supabase.from("entries").delete().is("archived_at", null);'), [1]);
  assertEquals(violations('// archive-ok: откат вставки\nawait supabase.from("entries").delete().eq("id", x);'), []);
});

Deno.test("каждая выборка записей в функциях отсекает архив, а удаление — архивирует", async () => {
  const found: string[] = [];
  for await (const file of sources(ROOT)) {
    const text = await Deno.readTextFile(file);
    for (const line of violations(text)) found.push(`${relative(ROOT, file)}:${line}`);
  }
  assertEquals(
    found,
    [],
    `Выборка из entries без фильтра архива или физическое удаление записи. Оберни выборку в ` +
      `onlyLiveEntries(...) из _shared/entries/live.ts, удаление замени на archiveEntry(...) из ` +
      `_shared/entries/archive.ts — или поставь над ней // archive-ok: <почему архив здесь нужен>`,
  );
});

Deno.test("onlyLiveEntries отсекает именно архив: is(archived_at, null)", () => {
  const calls: Array<[string, unknown]> = [];
  const builder = {
    is(column: string, value: null) {
      calls.push([column, value]);
      return builder;
    },
  };
  assertEquals(onlyLiveEntries(builder), builder, "построитель должен вернуться тот же — цепочка продолжается");
  assertEquals(calls, [["archived_at", null]]);
});
