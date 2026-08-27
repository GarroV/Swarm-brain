import { assert, assertEquals } from "jsr:@std/assert@1";
import { TASK_LIST_COLUMNS } from "./task-columns.ts";

const cols = () => TASK_LIST_COLUMNS.split(",").map((c) => c.trim());

Deno.test("не тянет description — 27% веса строки, в списках не рендерится", () => {
  assertEquals(cols().includes("description"), false);
});

Deno.test("не тянет ничего из того, что списки не читают", () => {
  for (const dead of ["note", "url", "tags", "task_role", "created_by", "group_id",
                      "confirmed", "owner_id", "updated_at", "timeline_position",
                      "remind_set_by", "*"]) {
    assertEquals(cols().includes(dead), false, `${dead} списками не читается`);
  }
});

Deno.test("тянет всё, что списки реально читают", () => {
  // Собрано grep'ом по экранам списков: строка задачи, спринт-доска, таймлайн, дерево
  // проекта, смарт-листы, дашборд. Пропуск любого поля = молчаливая деградация экрана,
  // ровно как было с metadata в GET /entries (issue #107).
  const need = [
    "id", "title", "status", "due_date", "start_date", "remind_date", "reminded_at",
    "priority", "country", "assignees", "assignee_telegram_ids", "label_ids",
    "project_id", "project_linked", "sprint_id", "parent_id", "tree_x", "tree_y",
    "meeting_id", "is_private", "created_at", "created_by_telegram_id",
  ];
  for (const f of need) assert(cols().includes(f), `${f} нужно списку, но не запрашивается`);
});

Deno.test("нет дублей и пустых имён", () => {
  const c = cols();
  assertEquals(c.length, new Set(c).size, "есть дубли");
  assertEquals(c.filter((x) => x === "").length, 0);
});
