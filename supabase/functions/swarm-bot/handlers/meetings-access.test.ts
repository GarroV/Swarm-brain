// Детектор дрифта на железное правило: личное пространство неприкосновенно при ЛЮБОМ действии
// (правило владельца 05.09.2026, issue #60).
//
// Почему детектор, а не обычный тест. Обработчик встреч в боте — это два десятка веток
// колбэков, и каждая раньше читала запись сама: `.from("entries").select(…).eq("id", …)
// .eq("group_id", …)`. Воркспейс есть, приватности нет — то есть участник воркспейса мог
// выгрузить содержимое ЧУЖОЙ ЛИЧНОЙ встречи файлом в Telegram, переписать ей рынки, название
// и дату. Единственной защитой было то, что id — UUID и его неоткуда взять; на неугадываемость
// полагаться нельзя, это не проверка.
//
// Обычный тест такую дыру не ловит: каждая новая ветка добавляется одной строкой и работает.
// Поэтому правило проверяется по исходнику — новая ветка обязана брать запись загрузчиком
// `loadEntryForAction`, который зовёт общий гард `_shared/entries/access.ts`.
import { assertEquals } from "jsr:@std/assert@1";

const HERE = new URL(".", import.meta.url).pathname;

/** Строки, где встреча читается напрямую по id, минуя загрузчик с проверкой. */
function rawSelectsById(src: string): number[] {
  const hits: number[] = [];
  const lines = src.split("\n");
  let current: string | null = null;
  let sawSelect = false;
  lines.forEach((line, i) => {
    const froms = [...line.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)];
    if (froms.length) { current = froms[froms.length - 1][1]; sawSelect = false; }
    if (current === "entries" && /\.select\(/.test(line)) sawSelect = true;
    // Чтение конкретной записи по id — ровно тот случай, который обязан идти через гард.
    if (current === "entries" && sawSelect && /\.eq\(\s*["'`]id["'`]/.test(line)) hits.push(i + 1);
    if (/;\s*$/.test(line)) { current = null; sawSelect = false; }
  });
  return hits;
}

Deno.test("встречу в боте нельзя прочитать по id мимо проверки доступа", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  // Единственное разрешённое место — сам загрузчик: он и делает проверку.
  const loaderStart = src.indexOf("async function loadEntryForAction");
  const loaderEnd = src.indexOf("\n}", loaderStart);
  const outside = src.slice(0, loaderStart) + "\n".repeat(src.slice(loaderStart, loaderEnd).split("\n").length) + src.slice(loaderEnd);

  const hits = rawSelectsById(outside);
  assertEquals(
    hits,
    [],
    `Встреча читается по id напрямую в строках: ${hits.join(", ")}. ` +
      "Нужен loadEntryForAction — он проверяет воркспейс и приватность одним гардом. " +
      "Личное пространство неприкосновенно при любом действии.",
  );
});

Deno.test("загрузчик действительно зовёт общий гард, а не свою проверку рядом", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  assertEquals(src.includes("entryAccessError("), true);
  assertEquals(src.includes('from "../../_shared/entries/access.ts"'), true);
});

Deno.test("детектор ловит именно ту форму, из-за которой всё и случилось", () => {
  const было = [
    'const { data: entry } = await supabase.from("entries")',
    '  .select("content, metadata")',
    '  .eq("id", entryId)',
    '  .eq("group_id", groupId)',
    "  .maybeSingle();",
  ].join("\n");
  assertEquals(rawSelectsById(было), [3]);
});
