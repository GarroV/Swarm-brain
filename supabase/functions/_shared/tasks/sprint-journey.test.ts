// Тесты написаны до реализации: «Ход задачи» — ядро этапа 4. Ошибка здесь молчит: неверно
// разложенный по спринтам комментарий или не тот срок на входе выглядят как правдоподобная
// история задачи, по которой человек потом объясняется с заказчиком.
import { assertEquals } from "@std/assert";
import {
  buildJourney,
  type DueChange,
  type JourneyComment,
  type JourneyCycle,
  type JourneyRow,
  type JourneyTask,
} from "./sprint-journey.ts";

const NOW = Date.parse("2026-11-20T10:00:00Z");

const cycles: JourneyCycle[] = [
  { id: "c4", name: "Спринт 4", start_date: "2026-10-20", end_date: "2026-11-02", status: "accepted" },
  { id: "c5", name: "Спринт 5", start_date: "2026-11-03", end_date: "2026-11-16", status: "accepted" },
  { id: "c6", name: "Спринт 6", start_date: "2026-11-17", end_date: "2026-11-30", status: "active" },
];

const row = (over: Partial<JourneyRow> & { cycle_id: string }): JourneyRow => ({
  moved_at: null,
  moved_to_cycle_id: null,
  moved_by: null,
  carry_reason: null,
  withdrawn_at: null,
  plan_reason: null,
  ...over,
});

const task = (over: Partial<JourneyTask> = {}): JourneyTask => ({
  title: "Договор с юристами",
  status: "open",
  due_date: "2026-11-30",
  completed_at: null,
  ...over,
});

const comment = (id: string, created_at: string, content = "апдейт"): JourneyComment => ({
  id,
  content,
  added_by: "Аня",
  created_at,
});

// Три спринта, два переноса: С4 → С5 (срок сдвинули), С5 → С6.
const movedTwice = {
  task: task({ due_date: "2026-11-30" }),
  rows: [
    row({
      cycle_id: "c4",
      moved_at: "2026-11-01T09:00:00Z",
      moved_to_cycle_id: "c5",
      moved_by: "777",
      carry_reason: "ждём юристов",
    }),
    row({
      cycle_id: "c5",
      moved_at: "2026-11-15T09:00:00Z",
      moved_to_cycle_id: "c6",
      moved_by: "777",
      carry_reason: "ушёл в отпуск ответственный",
    }),
    row({ cycle_id: "c6" }),
  ],
  cycles,
  comments: [] as JourneyComment[],
  dueChanges: [
    { old_value: "2026-11-02", new_value: "2026-11-16", created_at: "2026-11-01T09:00:00Z" },
    { old_value: "2026-11-16", new_value: "2026-11-30", created_at: "2026-11-15T09:00:00Z" },
  ] as DueChange[],
  now: NOW,
};

Deno.test("три спринта, два переноса: шаги по датам, итог считает переносы и срок на входе и выходе", () => {
  const j = buildJourney(movedTwice);
  assertEquals(j.steps.map((s) => s.cycle.id), ["c4", "c5", "c6"]);
  assertEquals(j.summary.sprints, 3);
  assertEquals(j.summary.moves, 2);
  assertEquals(j.steps[0].dueIn, "2026-11-02", "в С4 вошла со сроком, который потом сдвинули");
  assertEquals(j.steps[0].dueOut, "2026-11-16", "вышла уже с новым");
  assertEquals(j.steps[1].dueIn, "2026-11-16");
  assertEquals(j.steps[2].dueIn, "2026-11-30");
  assertEquals(j.steps[0].outcome.kind, "moved");
  assertEquals(j.steps[0].move, { toName: "Спринт 5", reason: "ждём юристов", by: "777", at: "2026-11-01T09:00:00Z" });
  assertEquals(j.steps[2].outcome.kind, "inProgress");
  assertEquals(j.steps[2].move, null);
});

Deno.test("отставание от первого срока: первый срок — тот, что стоял до первой правки", () => {
  const j = buildJourney(movedTwice);
  // Первый срок 02.11, на 20.11 задача не закрыта: отстаёт на 18 дней.
  assertEquals(j.summary.lateDays, 18);
});

Deno.test("комментарий в зазоре между спринтами уходит в ближайший предыдущий", () => {
  const gap: JourneyCycle[] = [
    { id: "a", name: "С1", start_date: "2026-10-01", end_date: "2026-10-10", status: "accepted" },
    { id: "b", name: "С2", start_date: "2026-10-20", end_date: "2026-10-30", status: "accepted" },
  ];
  const j = buildJourney({
    task: task({ status: "done", completed_at: "2026-10-28T10:00:00Z", due_date: "2026-10-30" }),
    rows: [row({ cycle_id: "a" }), row({ cycle_id: "b" })],
    cycles: gap,
    comments: [
      comment("k1", "2026-10-05T10:00:00Z"),
      comment("k2", "2026-10-15T10:00:00Z"), // зазор 11–19.10
      comment("k3", "2026-10-25T10:00:00Z"),
    ],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.steps[0].comments.map((c) => c.id), ["k1", "k2"]);
  assertEquals(j.steps[1].comments.map((c) => c.id), ["k3"]);
  assertEquals(j.summary.updates, 3);
});

Deno.test("комментарии-причины переноса и плана апдейтами не считаются", () => {
  const j = buildJourney({
    ...movedTwice,
    comments: [
      comment("r1", "2026-11-01T09:00:01Z", "Перенос (Спринт 4): ждём юристов"),
      comment("r2", "2026-11-17T09:00:00Z", "Carry-over (Спринт 5): waiting"),
      comment("r3", "2026-11-17T09:00:00Z", "План работы (Спринт 6): после срока"),
      comment("u1", "2026-11-18T09:00:00Z", "Договор у юристов"),
    ],
  });
  assertEquals(j.summary.updates, 1);
  assertEquals(j.steps[2].comments.map((c) => c.id), ["u1"]);
});

Deno.test("сделана в последнем спринте: итог «сделана», в срок или с опозданием", () => {
  const done = buildJourney({
    ...movedTwice,
    task: task({ status: "done", completed_at: "2026-11-25T12:00:00Z", due_date: "2026-11-30" }),
  });
  assertEquals(done.steps[2].outcome, { kind: "done", at: "2026-11-25T12:00:00Z", onTime: true });
  // Закрыта 25.11 при первом сроке 02.11: отставание 23 дня.
  assertEquals(done.summary.lateDays, 23);

  const late = buildJourney({
    ...movedTwice,
    task: task({ status: "done", completed_at: "2026-12-02T12:00:00Z", due_date: "2026-11-30" }),
  });
  assertEquals(late.steps[2].outcome, { kind: "done", at: "2026-12-02T12:00:00Z", onTime: false });
});

Deno.test("свои спринты подряд: между ними «продолжилась», причин нет", () => {
  const j = buildJourney({
    task: task({ due_date: "2026-11-30" }),
    rows: [row({ cycle_id: "c5" }), row({ cycle_id: "c6" })],
    cycles,
    comments: [],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.steps[0].outcome.kind, "continued");
  assertEquals(j.steps[1].outcome.kind, "inProgress");
  assertEquals(j.summary.moves, 0);
  assertEquals(j.summary.lateDays, -10, "срок 30.11, сегодня 20.11 — впереди на 10 дней");
});

Deno.test("снятая из спринта строка — шаг «снята», в счёт спринтов не идёт", () => {
  const j = buildJourney({
    task: task(),
    rows: [row({ cycle_id: "c5", withdrawn_at: "2026-11-10T10:00:00Z" }), row({ cycle_id: "c6" })],
    cycles,
    comments: [],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.steps[0].outcome.kind, "withdrawn");
  assertEquals(j.summary.sprints, 1);
});

Deno.test("перенос в удалённый спринт: цель неизвестна, шаг не падает", () => {
  const j = buildJourney({
    task: task(),
    rows: [row({ cycle_id: "c5", moved_at: "2026-11-10T10:00:00Z", moved_to_cycle_id: null })],
    cycles,
    comments: [],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.steps[0].move?.toName, null);
});

Deno.test("задача без спринтов: пустой путь, итог нулевой", () => {
  const j = buildJourney({
    task: task(),
    rows: [],
    cycles,
    comments: [comment("k", "2026-11-01T10:00:00Z")],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.steps, []);
  assertEquals(j.summary, { sprints: 0, moves: 0, updates: 0, daysInWork: 0, lateDays: -10 });
});

Deno.test("дни в работе: от начала первого начавшегося спринта до сегодня или закрытия", () => {
  const open = buildJourney(movedTwice);
  assertEquals(open.summary.daysInWork, 31, "с 20.10 по 20.11");
  const done = buildJourney({
    ...movedTwice,
    task: task({ status: "done", completed_at: "2026-11-05T10:00:00Z" }),
  });
  assertEquals(done.summary.daysInWork, 16, "с 20.10 по 05.11");
});

Deno.test("срок вообще не ставили: отставания нет, срок на входе пустой", () => {
  const j = buildJourney({
    task: task({ due_date: null }),
    rows: [row({ cycle_id: "c6" })],
    cycles,
    comments: [],
    dueChanges: [],
    now: NOW,
  });
  assertEquals(j.summary.lateDays, null);
  assertEquals(j.steps[0].dueIn, null);
});
