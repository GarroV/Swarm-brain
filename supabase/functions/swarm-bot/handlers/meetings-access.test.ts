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

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);

/** Строки, где встреча читается напрямую по id, минуя загрузчик с проверкой. */
function rawSelectsById(src: string): number[] {
  const hits: number[] = [];
  const lines = src.split("\n");
  let current: string | null = null;
  let sawSelect = false;
  lines.forEach((line, i) => {
    const froms = [...line.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)];
    if (froms.length) {
      current = froms[froms.length - 1][1];
      sawSelect = false;
    }
    if (current === "entries" && /\.select\(/.test(line)) sawSelect = true;
    // Чтение конкретной записи по id — ровно тот случай, который обязан идти через гард.
    if (
      current === "entries" && sawSelect && /\.eq\(\s*["'`]id["'`]/.test(line)
    ) hits.push(i + 1);
    if (/;\s*$/.test(line)) {
      current = null;
      sawSelect = false;
    }
  });
  return hits;
}

Deno.test("встречу в боте нельзя прочитать по id мимо проверки доступа", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  // Единственное разрешённое место — сам загрузчик: он и делает проверку.
  const loaderStart = src.indexOf("async function loadEntryForAction");
  const loaderEnd = src.indexOf("\n}", loaderStart);
  const outside = src.slice(0, loaderStart) +
    "\n".repeat(src.slice(loaderStart, loaderEnd).split("\n").length) +
    src.slice(loaderEnd);

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
  assertEquals(src.includes("meetingAccessError("), true);
  assertEquals(src.includes('from "../../_shared/entries/meeting-rights.ts"'), true);
});

// ── Права на правку и удаление (решение владельца 30.09.2026) ─────────────────
// Видимость ещё не право: общую встречу видит весь воркспейс, а править её могут автор,
// участники и админ, удалять — автор и админ (_shared/entries/meeting-rights.ts).
// Поэтому каждая ветка, которая пишет в entries, обязана брать встречу с действием
// edit/delete (или проверять права сама через canActOnMeeting).

/** Ветки обработчика: от `if (data|action.startsWith("…"))` до следующей такой же. */
function branches(src: string): Array<{ prefix: string; body: string }> {
  const re = /if \((?:data|action)\.startsWith\("([a-z_]+)"\)\)/g;
  const starts = [...src.matchAll(re)];
  return starts.map((m, i) => ({
    prefix: m[1],
    body: src.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : src.length),
  }));
}

// Архивация (archiveEntry, #569) — тоже запись: встреча пропадает у всех.
const WRITES_ENTRY = /\.from\("entries"\)\.(?:update\(|delete\(\))|archiveEntry\(/;
const CHECKS_RIGHTS = /action: "(?:edit|delete)"|canActOnMeeting\(/;

function unguardedWrites(src: string): string[] {
  return branches(src)
    .filter((b) => WRITES_ENTRY.test(b.body) && !CHECKS_RIGHTS.test(b.body))
    .map((b) => b.prefix);
}

Deno.test("каждая запись в entries из бота идёт после проверки прав на встречу", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  assertEquals(unguardedWrites(src), [], "ветки пишут встречу без проверки прав edit/delete");
});

Deno.test("удаление встречи: права delete и выход ДО удаления при отказе", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  const md = branches(src).find((b) => b.prefix === "md_");
  if (!md) throw new Error("ветка удаления md_ не найдена — детектор устарел");
  const guard = md.body.indexOf('action: "delete"');
  const refusal = md.body.search(/if \(!entry\) \{[^}]*return true;/);
  // Удаление встречи — архивация (#569): физического delete в ветке больше нет.
  const del = md.body.search(/archiveEntry\(/);
  assertEquals(del >= 0, true, "ветка md_ не архивирует встречу");
  assertEquals(
    /\.from\("(?:entries|tasks|task_history)"\)\.delete\(\)/.test(md.body),
    false,
    "встреча или её задачи стираются физически (#687)",
  );
  assertEquals(guard >= 0, true, "удаление берёт встречу без права delete");
  assertEquals(refusal >= 0 && refusal < del, true, "при отказе удаление всё равно выполняется");
});

Deno.test("детектор прав ловит ветку, которая пишет по одной лишь видимости", () => {
  const было = [
    'if (data.startsWith("md_")) {',
    '  const entry = await loadEntryForAction(entryId, groupId, userId, "metadata");',
    '  await supabase.from("entries").delete().eq("id", entryId);',
    "}",
  ].join("\n");
  assertEquals(unguardedWrites(было), ["md_"]);
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

// ── Список сохранённых встреч (rai_saved) ─────────────────────────────────────
// Список идёт по воркспейсу, и личные встречи в нём — только свои.
Deno.test("список сохранённых встреч фильтрует личные по владельцу", async () => {
  const src = await Deno.readTextFile(`${HERE}meetings.ts`);
  const start = src.indexOf('if (sub === "saved")');
  if (start < 0) throw new Error("ветка rai_saved не найдена — детектор устарел");
  const query = src.slice(start, src.indexOf(".limit(", start));
  assertEquals(/\.eq\("group_id", groupId\)/.test(query), true, "список не ограничен воркспейсом");
  assertEquals(/\.or\(visibilityFilter\(userId\)\)/.test(query), true, "список показывает чужие личные встречи");
});
