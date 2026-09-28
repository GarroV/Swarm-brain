import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  clampColumn,
  columnLayoutKey,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_ORDER,
  defaultLayout,
  gridMinWidth,
  gridTemplate,
  isDefaultLayout,
  moveColumn,
  resolveColumnLayout,
} from "./taskColumns.ts";

Deno.test("битое или пустое хранилище даёт дефолтную раскладку", () => {
  for (const junk of [null, undefined, "abc", 42, [], { widths: "wide" }, { widths: { project: NaN }, order: "x" }]) {
    assertEquals(resolveColumnLayout(junk), defaultLayout());
  }
});

Deno.test("сохранённая ширина вне пределов прижимается к границе", () => {
  const { widths } = resolveColumnLayout({ widths: { task: 5000, project: 3, assignee: 200, lists: Infinity } });
  assertEquals(widths, { task: 900, project: 72, assignee: 200, lists: DEFAULT_COLUMN_WIDTHS.lists });
});

Deno.test("порядок: чужие колонки выкидываются, дубли схлопываются, новые — в конец", () => {
  const { order } = resolveColumnLayout({ order: ["lists", "ghost", "lists", "due", "task"] });
  assertEquals(order, ["lists", "due", "actions", "market", "project", "assignee"]);
});

Deno.test("перестановка ставит колонку на место цели и не мутирует исходный порядок", () => {
  const before = [...DEFAULT_ORDER];
  assertEquals(moveColumn(before, "due", "project"), ["actions", "market", "project", "due", "assignee", "lists"]);
  assertEquals(moveColumn(before, "lists", "actions"), ["due", "lists", "actions", "market", "project", "assignee"]);
  assertEquals(moveColumn(before, "due", "due"), before);
  assertEquals(before, [...DEFAULT_ORDER]);
});

Deno.test("сетка идёт за порядком, а на узкой раскладке — без «Проекта» и «Списков»", () => {
  const l = { ...defaultLayout(), order: moveColumn(DEFAULT_ORDER, "assignee", "due") };
  assertEquals(gridTemplate(l, false), "minmax(260px,1fr) 160px 88px 168px 64px 128px 104px");
  assertEquals(gridTemplate(l, true), "minmax(260px,1fr) 160px 88px 168px 64px");
  assertEquals(gridMinWidth(l, true), 260 + 160 + 88 + 168 + 64);
});

Deno.test("дефолт распознаётся, любая правка — нет", () => {
  assert(isDefaultLayout(defaultLayout()));
  assert(!isDefaultLayout({ ...defaultLayout(), widths: { ...DEFAULT_COLUMN_WIDTHS, lists: 105 } }));
  assert(!isDefaultLayout({ ...defaultLayout(), order: moveColumn(DEFAULT_ORDER, "due", "actions") }));
});

Deno.test("перетаскивание округляет и держит пределы; ключ хранилища свой у человека", () => {
  assertEquals(clampColumn("assignee", 123.6), 124);
  assertEquals(clampColumn("lists", -40), 64);
  assertEquals(columnLayoutKey(744230399), "roy_task_columns_v1:744230399");
  assertEquals(columnLayoutKey(null), "roy_task_columns_v1:anon");
});
