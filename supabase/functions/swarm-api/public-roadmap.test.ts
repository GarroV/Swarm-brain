// Публичная дорожная карта (issue #562): правила отбора, маппинг статусов, порядок и белый
// список полей — на чистой сборке ответа. Ошибка здесь не падает, а тихо показывает наружу не
// то (закрытое поле, отменённую задачу, давно выкаченное), поэтому — тесты, а не «глянем на сайт».
// Путь через настоящую базу и обработчик — public-roadmap.db.test.ts.
import { assert, assertEquals } from "@std/assert";
import {
  BOARD_COLUMNS,
  buildRoadmap,
  isPublicRoadmapPath,
  PROJECT_COLUMNS,
  type RoadmapTaskRow,
  TASK_COLUMNS,
  toRoadmapItem,
} from "./public-roadmap.ts";

const NOW = new Date("2026-09-28T14:00:00.123Z");
const BOARD = {
  id: "b0000000-0000-4000-8000-000000000000",
  name: "Vibe Coding",
};
const SUB = "s0000000-0000-4000-8000-000000000001";

const task = (
  p: Partial<RoadmapTaskRow> & { title: string },
): RoadmapTaskRow => ({
  status: "open",
  due_date: null,
  completed_at: null,
  project_id: SUB,
  hidden_from_hub: false,
  is_private: false,
  archived_at: null,
  confirmed: true,
  ...p,
});

const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

// ── Маппинг статусов ────────────────────────────────────────────────────────────

Deno.test("статусы: backlog и open → planned, in_progress → in_progress, свежий done → shipped", () => {
  assertEquals(
    toRoadmapItem(task({ title: "a", status: "backlog" }), NOW)?.state,
    "planned",
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", status: "open" }), NOW)?.state,
    "planned",
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", status: "in_progress" }), NOW)?.state,
    "in_progress",
  );
  assertEquals(
    toRoadmapItem(
      task({ title: "a", status: "done", completed_at: daysAgo(1) }),
      NOW,
    )?.state,
    "shipped",
  );
});

Deno.test("cancelled и неизвестный статус не отдаются никогда", () => {
  assertEquals(
    toRoadmapItem(
      task({ title: "a", status: "cancelled", completed_at: daysAgo(1) }),
      NOW,
    ),
    null,
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", status: "pending" }), NOW),
    null,
  );
  assertEquals(toRoadmapItem(task({ title: "a", status: null }), NOW), null);
});

Deno.test("done старше 30 дней не попадает, ровно 30 дней — ещё на хабе", () => {
  assertEquals(
    toRoadmapItem(
      task({ title: "a", status: "done", completed_at: daysAgo(31) }),
      NOW,
    ),
    null,
  );
  assertEquals(
    toRoadmapItem(
      task({ title: "a", status: "done", completed_at: daysAgo(30) }),
      NOW,
    )?.state,
    "shipped",
  );
});

Deno.test("done без даты закрытия не попадает: окно не проверить — значит, не показываем", () => {
  assertEquals(
    toRoadmapItem(
      task({ title: "a", status: "done", completed_at: null }),
      NOW,
    ),
    null,
  );
});

Deno.test("скрытая с хаба, личная, архивная и неподтверждённая задачи не попадают", () => {
  assertEquals(
    toRoadmapItem(task({ title: "a", hidden_from_hub: true }), NOW),
    null,
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", is_private: true }), NOW),
    null,
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", archived_at: daysAgo(1) }), NOW),
    null,
  );
  assertEquals(
    toRoadmapItem(task({ title: "a", confirmed: false }), NOW),
    null,
  );
});

Deno.test("даты: due и shipped_at — YYYY-MM-DD или null", () => {
  assertEquals(
    toRoadmapItem(task({ title: "a", due_date: "2026-10-06" }), NOW),
    {
      title: "a",
      state: "planned",
      due: "2026-10-06",
      shipped_at: null,
    },
  );
  assertEquals(
    toRoadmapItem(
      task({
        title: "a",
        status: "done",
        completed_at: "2026-09-27T21:15:00+00:00",
      }),
      NOW,
    ),
    { title: "a", state: "shipped", due: null, shipped_at: "2026-09-27" },
  );
});

// ── Белый список полей ────────────────────────────────────────────────────────

Deno.test("в ответе только поля договора: закрытые колонки строки наружу не уходят", () => {
  // Строка «как из базы» с лишними закрытыми полями — будто кто-то расширил select.
  const leaky = {
    ...task({ title: "Веб", status: "in_progress" }),
    id: "t1",
    description: "секрет",
    assignees: ["Вася"],
    assignee_telegram_ids: [1],
    country: "RS",
    tags: ["x"],
    label_ids: ["l"],
    owner_id: 1,
    group_id: "cee",
  } as unknown as RoadmapTaskRow;
  const out = buildRoadmap({
    board: BOARD,
    projects: [{
      id: SUB,
      name: "DECIMUS",
      position: 1,
      created_at: daysAgo(10),
    }],
    tasks: [leaky],
    now: NOW,
  });
  assertEquals(Object.keys(out).sort(), ["board", "generated_at", "projects"]);
  assertEquals(Object.keys(out.projects[0]).sort(), ["id", "items", "name"]);
  assertEquals(Object.keys(out.projects[0].items[0]).sort(), [
    "due",
    "shipped_at",
    "state",
    "title",
  ]);
  const text = JSON.stringify(out);
  for (
    const secret of [
      "секрет",
      "Вася",
      "RS",
      "cee",
      "t1",
      "description",
      "assignee",
    ]
  ) {
    assert(!text.includes(secret), `в ответ утекло «${secret}»: ${text}`);
  }
});

Deno.test("select'ы узкие: ни *, ни закрытых колонок в проекциях", () => {
  const closed = [
    "*",
    "description",
    "assignees",
    "assignee_telegram_ids",
    "country",
    "tags",
    "label_ids",
    "owner_id",
    "note",
    "links",
  ];
  for (const cols of [BOARD_COLUMNS, PROJECT_COLUMNS, TASK_COLUMNS]) {
    const list = cols.split(",").map((c) => c.trim());
    for (const c of closed) {
      assert(!list.includes(c), `колонка ${c} в проекции «${cols}»`);
    }
  }
});

// ── Состав и порядок ──────────────────────────────────────────────────────────

Deno.test("порядок пунктов: in_progress, planned по сроку (без срока в конце), shipped новые сверху", () => {
  const out = buildRoadmap({
    board: BOARD,
    projects: [{ id: SUB, name: "P", position: 1, created_at: daysAgo(10) }],
    tasks: [
      task({ title: "план без срока", status: "open" }),
      task({
        title: "выкачено давно",
        status: "done",
        completed_at: daysAgo(20),
      }),
      task({
        title: "план поздний",
        status: "backlog",
        due_date: "2026-11-01",
      }),
      task({
        title: "в работе",
        status: "in_progress",
        due_date: "2026-12-01",
      }),
      task({
        title: "выкачено вчера",
        status: "done",
        completed_at: daysAgo(1),
      }),
      task({ title: "план ранний", status: "open", due_date: "2026-10-01" }),
    ],
    now: NOW,
  });
  assertEquals(out.projects[0].items.map((i) => i.title), [
    "в работе",
    "план ранний",
    "план поздний",
    "план без срока",
    "выкачено вчера",
    "выкачено давно",
  ]);
});

Deno.test("проекты: доска только со своими пунктами и первой, подпроекты — в порядке доски", () => {
  const A = "a0000000-0000-4000-8000-000000000001";
  const B = "a0000000-0000-4000-8000-000000000002";
  const C = "a0000000-0000-4000-8000-000000000003";
  const rows = [
    { id: C, name: "без позиции", position: null, created_at: daysAgo(30) },
    { id: B, name: "второй", position: 2000, created_at: daysAgo(1) },
    { id: A, name: "первый", position: 1000, created_at: daysAgo(2) },
  ];
  const withoutOwn = buildRoadmap({
    board: BOARD,
    projects: rows,
    tasks: [],
    now: NOW,
  });
  assertEquals(withoutOwn.projects.map((p) => p.name), [
    "первый",
    "второй",
    "без позиции",
  ]);
  assertEquals(withoutOwn.projects[0].items, []);

  const withOwn = buildRoadmap({
    board: BOARD,
    projects: rows,
    tasks: [task({ title: "своя", project_id: BOARD.id })],
    now: NOW,
  });
  assertEquals(withOwn.projects.map((p) => p.name), [
    "Vibe Coding",
    "первый",
    "второй",
    "без позиции",
  ]);
  assertEquals(withOwn.board, "Vibe Coding");
  assertEquals(withOwn.generated_at, "2026-09-28T14:00:00Z");
});

// ── Маршрут ────────────────────────────────────────────────────────────────────

Deno.test("маршрут: узнаётся только /public/roadmap[/id]", () => {
  assert(
    isPublicRoadmapPath("/public/roadmap/d8299ea3-6a8f-4e57-bbfb-4a9b0a53aea9"),
  );
  assert(isPublicRoadmapPath("/public/roadmap/"));
  assert(isPublicRoadmapPath("/public/roadmap"));
  assert(!isPublicRoadmapPath("/public/roadmap/x/y"));
  assert(!isPublicRoadmapPath("/tasks"));
  assert(!isPublicRoadmapPath("/public/roadmapx/1"));
});
