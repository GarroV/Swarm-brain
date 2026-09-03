// Миграция сохранённого вида доски задач (issue #216): у команды в localStorage лежит
// activeList: "done" от прежней версии, где «Готовые» были пунктом оси времени.
import { assertEquals } from "jsr:@std/assert";
import { migrateSavedView, savedStatuses } from "./tasksView.ts";
import { DEFAULT_STATUSES } from "./smartLists.ts";

Deno.test("старый вид «Готовые» переезжает на «Все» + чип «Готово», а не в пустой экран", () => {
  const got = migrateSavedView({ activeList: "done", lens: "mine" });
  assertEquals(got?.activeList, "all");
  assertEquals(got?.statuses, ["done"]);
  assertEquals(got?.lens, "mine");
});

Deno.test("обычный сохранённый вид не трогается", () => {
  const got = migrateSavedView({ activeList: "today", lens: "team", byMarket: true });
  assertEquals(got, { activeList: "today", lens: "team", byMarket: true });
});

Deno.test("пустого хранилища нет — миграция возвращает null", () => {
  assertEquals(migrateSavedView(null), null);
});

Deno.test("нет сохранённых статусов → дефолт «Открыто + В работе»", () => {
  assertEquals(savedStatuses(null), DEFAULT_STATUSES);
  assertEquals(savedStatuses({ activeList: "all" }), DEFAULT_STATUSES);
});

Deno.test("пустой набор статусов сохраняется как есть (законный выбор «без фильтра»)", () => {
  assertEquals([...savedStatuses({ statuses: [] })], []);
});

Deno.test("незнакомые статусы из хранилища выбрасываются", () => {
  assertEquals([...savedStatuses({ statuses: ["done", "bogus" as never, "open"] })].sort(), ["done", "open"]);
});
