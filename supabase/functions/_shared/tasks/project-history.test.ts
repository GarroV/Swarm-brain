// Чистая часть журнала проектов: какие строки породит патч (issue #426).
import { assertEquals } from "@std/assert";
import { projectEventRow, projectHistoryRowsFor } from "./project-history.ts";

const SNAPSHOT = {
  id: "p1",
  group_id: "ws",
  name: "Маркетинг",
  sprint_id: "space-old",
  parent_id: null,
  is_private: false,
  created_at: "2026-09-01T00:00:00Z",
  created_by: 1,
  archived_at: null,
};

Deno.test("пишутся только реально изменившиеся поля", () => {
  const rows = projectHistoryRowsFor({
    projectId: "p1",
    snapshot: SNAPSHOT,
    // Патч несёт всю форму, включая неизменное имя — оно в журнал попасть не должно.
    patch: { name: "Маркетинг", sprint_id: "space-new" },
    actorTelegramId: 7,
    groupId: "ws",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].field, "space");
  assertEquals(rows[0].old_value, "space-old");
  assertEquals(rows[0].new_value, "space-new");
  assertEquals(rows[0].changed_by_telegram_id, 7);
  // Колонка text NOT NULL — код обязан подставить значение сам (та же мина, что в task_history).
  assertEquals(rows[0].changed_by, "7");
});

Deno.test("служебное в журнал не идёт", () => {
  const rows = projectHistoryRowsFor({
    projectId: "p1",
    snapshot: SNAPSHOT,
    patch: {
      group_id: "другой",
      created_by: 99,
      // Архивация — событие, а не поле: «archived_at: null → 2026-…» человеку ничего не говорит.
      archived_at: "2026-09-21T10:00:00Z",
      archived_by: 7,
    },
    groupId: "ws",
  });
  assertEquals(rows, []);
});

Deno.test("без снимка журнал молчит, а не пишет выдумку", () => {
  assertEquals(
    projectHistoryRowsFor({
      projectId: "p1",
      snapshot: null,
      patch: { name: "Новое" },
    }),
    [],
  );
});

Deno.test("событие жизненного цикла: актор всегда назван", () => {
  const row = projectEventRow({
    projectId: "p1",
    event: "archived",
    value: "с подпроектами: 2",
    groupId: "ws",
  });
  assertEquals(row.field, "archived");
  assertEquals(row.new_value, "с подпроектами: 2");
  assertEquals(row.changed_by, "system");
  assertEquals(row.changed_by_telegram_id, null);
});
