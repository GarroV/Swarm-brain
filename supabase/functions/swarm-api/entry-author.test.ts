// Детектор дрифта на правило «у записи всегда есть автор».
//
// Правило владельца: кто записал встречу и завёл её в систему — тот и автор. Оно жило только
// в голове, и в коде публикации стояло `owner_id: isPrivate ? telegram_id : null` — у общей
// записи автор стирался. За неделю так набралось 42 записи из 49 без автора, и их автор не мог
// ни поправить, ни удалить свою же встречу: PATCH/DELETE /entries/:id требуют владельца.
//
// Почему это не ловится обычным юнит-тестом: вставка в entries — один литерал в 2000-строчном
// роутере, и `owner_id: null` не роняет ничего. Запись создаётся, экран работает, автор просто
// пуст. Ровно так это и прожило незамеченным.
//
// Ошибка воспроизводима по смыслу: owner_id тащит две роли — авторство и ключ приватности.
// Для видимости ОБЩЕЙ записи он не нужен (фильтр `is_private=false OR owner_id=…` проходит по
// первой половине), и следующий читатель снова решит, что писать его незачем. Поэтому правило
// закреплено тестом, а не комментарием.
import { assertEquals } from "jsr:@std/assert@1";

const HERE = new URL(".", import.meta.url).pathname;

/** Строки вида `owner_id: <что-то условное>` внутри вставки в entries. */
function conditionalOwnerOnEntries(src: string): number[] {
  const hits: number[] = [];
  let current: string | null = null;
  src.split("\n").forEach((line, i) => {
    const froms = [...line.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)];
    if (froms.length) current = froms[froms.length - 1][1];
    // Интересует только вставка/обновление entries: `owner_id` с тернаркой или с null.
    if (current === "entries" && /owner_id\s*:/.test(line) && /\?|null/.test(line)) {
      hits.push(i + 1);
    }
    if (/;\s*$/.test(line) && !/owner_id\s*:/.test(line)) current = null;
  });
  return hits;
}

Deno.test("у записи всегда есть автор: owner_id в entries не условный и не null", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  const hits = conditionalOwnerOnEntries(src);
  assertEquals(
    hits,
    [],
    `owner_id у entries записан условно или как null в строках: ${hits.join(", ")}. ` +
      "Автор записи — тот, кто её завёл; для видимости общей записи owner_id не нужен, " +
      "но без него автор теряет право править и удалять собственную запись.",
  );
});

Deno.test("детектор ловит ту самую формулировку, из-за которой всё и случилось", () => {
  const было = [
    'await supabase.from("entries").insert({',
    "  content: draft,",
    "  is_private: isPrivate,",
    "  owner_id: isPrivate ? telegram_id : null,",
    "});",
  ].join("\n");
  assertEquals(conditionalOwnerOnEntries(было), [4]);
});

Deno.test("правильная запись автора детектор не трогает", () => {
  const стало = [
    'await supabase.from("entries").insert({',
    "  content: draft,",
    "  is_private: isPrivate,",
    "  owner_id: telegram_id,",
    "});",
  ].join("\n");
  assertEquals(conditionalOwnerOnEntries(стало), []);
});
