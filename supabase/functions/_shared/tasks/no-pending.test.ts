// Детектор дрифта: у задач нет статуса, который резолвится только в боте.
//
// История. Бот и read-ai-webhook сами вытаскивали задачи из транскрипта встречи и клали их в
// статус `pending`. Подтвердить такую задачу можно было ТОЛЬКО карточкой в Telegram, а веб этот
// статус не показывал вовсе — он был в списке замьюченных. На проде так осело 32 задачи с
// исполнителями и сроками, которых полтора месяца не видел ни один человек, включая владельца
// (issue #208). Обе трубы убраны 05.09.2026 по решению владельца, задачи удалены.
//
// Почему детектор. Такую дыру не ловит ни один обычный тест: задача создаётся, запись в базе
// есть, ошибок нет, экран работает — просто строки нигде не видно. Единственное, что здесь
// падает, — проверка по исходнику.
//
// Правило: задача попадает в базу только по явному действию человека и сразу в рабочем статусе.
// Автоматическое извлечение задач из встречи живёт в интерфейсе («Сгенерировать задачи»):
// предложения показываются человеку, в базу едет выбранное.
import { assertEquals } from "jsr:@std/assert@1";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Комментарии срезаем: в них имена убранных функций стоят намеренно, как память о причине.
 *  Проверяем КОД — иначе тест падает на собственных объяснениях (так и случилось). */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
}

/** Все .ts функций, кроме тестов. */
async function sources(): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  async function walk(dir: string) {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) {
        out.push({ path: p.slice(ROOT.length), text: codeOnly(await Deno.readTextFile(p)) });
      }
    }
  }
  await walk(ROOT.replace(/\/$/, ""));
  return out;
}

Deno.test("никто не создаёт задачу в статусе pending", async () => {
  const виноватые = (await sources())
    .filter((f) => /status:\s*["'`]pending["'`]/.test(f.text))
    .map((f) => f.path);
  assertEquals(
    виноватые,
    [],
    `Статус pending пишут: ${виноватые.join(", ")}. ` +
      "Такая задача не видна ни в вебе, ни в рекордере — только в боте. " +
      "Задача создаётся по явному действию человека и сразу в рабочем статусе.",
  );
});

Deno.test("бот не извлекает задачи из встречи сам", async () => {
  const src = await sources();
  const есть = src.filter((f) => /analyzeAndCreateTasks|extractAndSaveTasks/.test(f.text)).map((f) => f.path);
  assertEquals(
    есть,
    [],
    `Авто-извлечение задач вернулось: ${есть.join(", ")}. ` +
      "Задачи из встречи делает человек кнопкой «Сгенерировать задачи» в вебе.",
  );
});

Deno.test("детектор ловит ту самую форму", () => {
  const было = 'await supabase.from("tasks").insert({ title, status: "pending", group_id: "cee" });';
  assertEquals(/status:\s*["'`]pending["'`]/.test(было), true);
  const стало = 'await supabase.from("tasks").insert({ title, status: "open", confirmed: true });';
  assertEquals(/status:\s*["'`]pending["'`]/.test(стало), false);
});
