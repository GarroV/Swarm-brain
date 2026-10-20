// Тесты до реализации. Правило размещения — ядро: ошибка молчит (задача окажется не в том спринте,
// и план/факт команды расходятся с жизнью), а ошибка в генерации спринтов способна наплодить их
// сотнями. Решение владельца 19.10.2026 — docs/decisions/2026-10-19-sprints-go-live-and-auto-by-deadline.md.
import { assertEquals } from "@std/assert";
import { type PlacementCycle, type PlacementInput, planPlacement } from "./sprint-autoplace.ts";

const TODAY = "2026-10-20";
const A: PlacementCycle = {
  id: "A",
  status: "active",
  name: "Спринт 4 · 20.10 — 02.11",
  start_date: "2026-10-20",
  end_date: "2026-11-02",
};
const F1: PlacementCycle = {
  id: "F1",
  status: "draft",
  name: "Спринт 5 · 03.11 — 16.11",
  start_date: "2026-11-03",
  end_date: "2026-11-16",
};
const F2: PlacementCycle = {
  id: "F2",
  status: "draft",
  name: "Спринт 6 · 17.11 — 30.11",
  start_date: "2026-11-17",
  end_date: "2026-11-30",
};

function input(over: Partial<PlacementInput>): PlacementInput {
  return {
    due: "2026-10-25",
    today: TODAY,
    cycles: [A, F1, F2],
    inActive: true,
    draftIds: [],
    carry: { to_carry: false, auto: false, reason: null },
    ...over,
  };
}

Deno.test("срок снят — ничего не происходит", () => {
  const p = planPlacement(input({ due: null }));
  assertEquals(p, {
    addToActive: false,
    setCarry: false,
    clearCarry: false,
    targetId: null,
    create: [],
    removeDraftIds: [],
    limited: false,
  });
});

Deno.test("срок раньше старта идущего спринта (просрочено) — ничего", () => {
  const p = planPlacement(input({ due: "2026-10-10", draftIds: ["F1"] }));
  assertEquals(p.removeDraftIds, []);
  assertEquals(p.setCarry, false);
  assertEquals(p.targetId, null);
});

Deno.test("срок внутри идущего, задачи в нём нет — добавить в идущий и убрать из будущих", () => {
  const p = planPlacement(input({ due: "2026-10-30", inActive: false, carry: null, draftIds: ["F1"] }));
  assertEquals(p.addToActive, true);
  assertEquals(p.removeDraftIds, ["F1"]);
  assertEquals(p.targetId, null);
});

Deno.test("срок внутри идущего, задача в нём уже есть — ничего не добавляем", () => {
  const p = planPlacement(input({ due: "2026-10-30" }));
  assertEquals(p.addToActive, false);
});

Deno.test("срок вернули в идущий: отметка от автоматики без причины снимается", () => {
  const p = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: null } }));
  assertEquals(p.clearCarry, true);
});

Deno.test("отметку человека или с причиной не снимаем", () => {
  const byHuman = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: false, reason: null } }));
  assertEquals(byHuman.clearCarry, false);
  const withReason = planPlacement(
    input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: "ждём поставщика" } }),
  );
  assertEquals(withReason.clearCarry, false);
  const blank = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: "   " } }));
  assertEquals(blank.clearCarry, true, "пробелы — это пустая причина");
});

Deno.test("срок за концом идущего: пометка переноса и задача в спринте срока", () => {
  const p = planPlacement(input({ due: "2026-11-20" }));
  assertEquals(p.setCarry, true);
  assertEquals(p.targetId, "F2");
  assertEquals(p.create, []);
});

Deno.test("пометка переноса уже стоит — второй раз не ставим", () => {
  const p = planPlacement(input({ due: "2026-11-20", carry: { to_carry: true, auto: false, reason: null } }));
  assertEquals(p.setCarry, false);
});

Deno.test("задача в будущем G, срок попал в F — убрать из G, дублей нет", () => {
  const p = planPlacement(input({ due: "2026-11-10", inActive: false, carry: null, draftIds: ["F2"] }));
  assertEquals(p.targetId, "F1");
  assertEquals(p.removeDraftIds, ["F2"]);
  assertEquals(p.setCarry, false, "в идущем задачи нет — переносить нечего");
});

Deno.test("задача уже в спринте своего срока — её там и оставляем", () => {
  const p = planPlacement(input({ due: "2026-11-10", inActive: false, carry: null, draftIds: ["F1"] }));
  assertEquals(p.targetId, "F1");
  assertEquals(p.removeDraftIds, []);
});

Deno.test("срок дальше всех спринтов: создаются все промежуточные подряд, без дыр", () => {
  const p = planPlacement(input({ due: "2026-12-20" }));
  assertEquals(p.create.map((c) => c.name), [
    "Спринт 7 · 01.12 — 14.12",
    "Спринт 8 · 15.12 — 28.12",
  ]);
  assertEquals(p.create.map((c) => c.start_date), ["2026-12-01", "2026-12-15"]);
  assertEquals(p.create[1].check_date, "2026-12-21");
  assertEquals(p.targetId, null, "целевой — последний из создаваемых, у него ещё нет id");
  assertEquals(p.setCarry, true);
});

Deno.test("срок ровно в последний день созданного спринта — без лишнего ещё одного", () => {
  const p = planPlacement(input({ due: "2026-12-14" }));
  assertEquals(p.create.length, 1);
});

Deno.test("опечатка в сроке (2036) спринтов не плодит, пометка переноса в идущем остаётся", () => {
  const p = planPlacement(input({ due: "2036-10-25" }));
  assertEquals(p.create, []);
  assertEquals(p.targetId, null);
  assertEquals(p.limited, true);
  assertEquals(p.setCarry, true);
});

Deno.test("предел: 364 дня от сегодняшнего ещё можно, дальше — нет", () => {
  // Сегодня 20.10.2026; +364 дня = 19.10.2027.
  const within = planPlacement(input({ due: "2027-10-19" }));
  assertEquals(within.limited, false);
  assertEquals(within.create.length > 0, true);
  const beyond = planPlacement(input({ due: "2027-10-20" }));
  assertEquals(beyond.limited, true);
  assertEquals(beyond.create, []);
});

Deno.test("создаваемых больше 26 подряд (заброшенное пространство) — не создаём ничего", () => {
  const old: PlacementCycle = {
    id: "O",
    status: "draft",
    name: "Спринт 1 · 01.01 — 14.01",
    start_date: "2025-01-01",
    end_date: "2025-01-14",
  };
  const p = planPlacement(input({ due: "2026-12-20", cycles: [old], inActive: false, carry: null, draftIds: [] }));
  assertEquals(p.create, []);
  assertEquals(p.limited, true);
});

Deno.test("срок в зазоре между спринтами (дыра заведена руками) — не создаём и не двигаем", () => {
  const gap: PlacementCycle = { ...F2, start_date: "2026-11-24", end_date: "2026-12-07" };
  const p = planPlacement(
    input({ due: "2026-11-20", cycles: [A, F1, gap], inActive: false, carry: null, draftIds: ["F1"] }),
  );
  assertEquals(p.targetId, null);
  assertEquals(p.create, []);
  assertEquals(p.removeDraftIds, [], "задача остаётся где была");
});

Deno.test("идущего спринта нет: срок в будущем F — добавить в F", () => {
  const p = planPlacement(
    input({ due: "2026-11-20", cycles: [F1, F2], inActive: false, carry: null, draftIds: ["F1"] }),
  );
  assertEquals(p.targetId, "F2");
  assertEquals(p.removeDraftIds, ["F1"]);
  assertEquals(p.addToActive, false);
  assertEquals(p.setCarry, false);
});

Deno.test("идущего нет, срок раньше всех спринтов — ничего", () => {
  const p = planPlacement(
    input({ due: "2026-10-01", cycles: [F1, F2], inActive: false, carry: null, draftIds: ["F1"] }),
  );
  assertEquals(p.targetId, null);
  assertEquals(p.removeDraftIds, []);
});

Deno.test("принятые спринты не цель и не сбивают нумерацию: следующий считается от последнего по дате", () => {
  const done: PlacementCycle = {
    id: "D",
    status: "accepted",
    name: "Спринт 3 · 06.10 — 19.10",
    start_date: "2026-10-06",
    end_date: "2026-10-19",
  };
  const p = planPlacement(input({ due: "2026-11-10", cycles: [done, A], inActive: true }));
  assertEquals(p.create.map((c) => c.name), [
    "Спринт 5 · 03.11 — 16.11",
  ]);
  assertEquals(p.setCarry, true);
});
