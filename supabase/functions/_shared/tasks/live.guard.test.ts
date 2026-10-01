// Сторож «живой задачи» (#575): каждая ЧИТАЮЩАЯ выборка из `tasks` в коде функций обязана
// отсечь архив — обернуться в `onlyLive(...)`, фильтровать `archived_at` сама или нести рядом
// пометку `// archive-ok: <почему>` (журнал, уборка, запись по id — там архив нужен или не мешает).
//
// Зачем тест, а не правило в доке: правило в доке уже было (QUICK_REF, «читающая обязана
// фильтровать»), и всё равно его пропустили бот, напоминания и спринты. Новый читатель без
// фильтра теперь валит прогон, а не тихо тащит архив людям.
import { assertEquals } from "@std/assert";
import { onlyLive } from "./live.ts";
import { fromFileUrl, join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const NEEDLE = '.from("tasks")';
/** Сколько символов после `.from("tasks")` считаем одной цепочкой запроса. */
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

/** Цепочка запроса: от `.from("tasks")` до конца выражения (`;`), не дальше окна. */
function chainAfter(text: string, at: number): string {
  const rest = text.slice(at, at + WINDOW);
  const end = rest.indexOf(";");
  return end === -1 ? rest : rest.slice(0, end);
}

function isRead(chain: string): boolean {
  const ops = chain.match(/\.(select|update|insert|upsert|delete)\(/);
  return ops?.[1] === "select";
}

/** Нарушения в одном исходнике — экспортировано не наружу, а для проверки самого сторожа. */
export function violations(text: string): number[] {
  const out: number[] = [];
  let at = text.indexOf(NEEDLE);
  while (at !== -1) {
    const chain = chainAfter(text, at);
    const lineNo = text.slice(0, at).split("\n").length;
    const before = text.slice(0, at).split("\n").slice(-1 - MARK_LINES).join("\n");
    const ok = !isRead(chain) ||
      chain.includes("archived_at") ||
      /onlyLive\(\s*[\w.]*\s*$/.test(text.slice(Math.max(0, at - 80), at)) ||
      before.includes("archive-ok:");
    if (!ok) out.push(lineNo);
    at = text.indexOf(NEEDLE, at + NEEDLE.length);
  }
  return out;
}

Deno.test("сторож ловит выборку задач без фильтра архива", () => {
  const bad = 'const { data } = await supabase.from("tasks").select("id").eq("x", 1);';
  assertEquals(violations(bad), [1]);
  assertEquals(violations('await onlyLive(supabase.from("tasks").select("id")).eq("x", 1);'), []);
  assertEquals(violations('await supabase.from("tasks").select("id").is("archived_at", null);'), []);
  assertEquals(violations('// archive-ok: журнал\nawait supabase.from("tasks").select("id");'), []);
  assertEquals(violations('await supabase.from("tasks").update({ a: 1 }).eq("id", x);'), []);
});

Deno.test("каждая выборка задач в функциях отсекает архив", async () => {
  const found: string[] = [];
  for await (const file of sources(ROOT)) {
    const text = await Deno.readTextFile(file);
    for (const line of violations(text)) found.push(`${relative(ROOT, file)}:${line}`);
  }
  assertEquals(
    found,
    [],
    `Выборка из tasks без фильтра архива. Оберни в onlyLive(...) из _shared/tasks/live.ts ` +
      `или поставь над ней // archive-ok: <почему архив здесь нужен>`,
  );
});

Deno.test("onlyLive отсекает именно архив: is(archived_at, null)", () => {
  const calls: Array<[string, unknown]> = [];
  const builder = {
    is(column: string, value: null) {
      calls.push([column, value]);
      return builder;
    },
  };
  assertEquals(onlyLive(builder), builder, "построитель должен вернуться тот же — цепочка продолжается");
  assertEquals(calls, [["archived_at", null]]);
});
