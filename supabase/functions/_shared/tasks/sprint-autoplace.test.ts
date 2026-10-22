// Тесты до реализации. Правило размещения — ядро: ошибка молчит (задача окажется не в том спринте,
// и план/факт команды расходятся с жизнью), а ошибка в генерации спринтов способна наплодить их
// сотнями. Решение владельца 19.10.2026 — docs/decisions/2026-10-19-sprints-go-live-and-auto-by-deadline.md;
// с 22.10.2026 смена срока ПЕРЕНОСИТ задачу (снимок в идущем) и не сносит план на несколько спринтов —
// docs/superpowers/specs/2026-10-22-sprint-board-design.md, «Правила на граничные случаи».
import { assertEquals } from "@std/assert";
import { newCycleRef, type PlacementCycle, type PlacementInput, planPlacement } from "./sprint-autoplace.ts";

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
    activeRow: "live",
    draftIds: [],
    carry: { to_carry: false, auto: false, reason: null },
    ...over,
  };
}

const notInActive = { activeRow: null, carry: null } as const;

Deno.test("срок снят — ничего не происходит", () => {
  const p = planPlacement(input({ due: null }));
  assertEquals(p, {
    addToActive: false,
    revive: false,
    clearCarry: false,
    move: null,
    extendTo: null,
    create: [],
    removeDraftIds: [],
    limited: false,
  });
});

Deno.test("срок раньше старта идущего спринта (просрочено) — ничего", () => {
  const p = planPlacement(input({ due: "2026-10-10", draftIds: ["F1"] }));
  assertEquals(p.removeDraftIds, []);
  assertEquals(p.move, null);
  assertEquals(p.extendTo, null);
});

Deno.test("срок внутри идущего, задача только в будущем — добавить в идущий, будущую строку убрать", () => {
  const p = planPlacement(input({ due: "2026-10-30", ...notInActive, draftIds: ["F1"] }));
  assertEquals(p.addToActive, true);
  assertEquals(p.removeDraftIds, ["F1"]);
  assertEquals(p.move, null);
});

Deno.test("срок внутри идущего, у задачи план на два будущих — добавить в идущий, план не сносить", () => {
  const p = planPlacement(input({ due: "2026-10-30", ...notInActive, draftIds: ["F1", "F2"] }));
  assertEquals(p.addToActive, true);
  assertEquals(p.removeDraftIds, [], "строки плана триггер не удаляет никогда");
});

Deno.test("срок внутри идущего, задача в нём уже есть — ничего не добавляем и не убираем", () => {
  const p = planPlacement(input({ due: "2026-10-30", draftIds: ["F1"] }));
  assertEquals(p.addToActive, false);
  assertEquals(p.removeDraftIds, []);
});

Deno.test("срок вернули в идущий: снимок оживает, строка, созданная переносом, снимается", () => {
  const p = planPlacement(
    input({ due: "2026-10-30", activeRow: "snapshot", draftIds: ["F2"], snapshotTargetId: "F2" }),
  );
  assertEquals(p.revive, true);
  assertEquals(p.removeDraftIds, ["F2"]);
  assertEquals(p.addToActive, false, "дубля нет: оживает та же строка");
});

Deno.test("срок вернули, а в цели задача стояла по плану ещё до переноса — цель не трогаем", () => {
  const p = planPlacement(
    input({ due: "2026-10-30", activeRow: "snapshot", draftIds: ["F2"], snapshotTargetId: null }),
  );
  assertEquals(p.revive, true);
  assertEquals(p.removeDraftIds, []);
});

Deno.test("старая пометка автоматики без причины снимается, когда срок вернули", () => {
  const p = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: null } }));
  assertEquals(p.clearCarry, true);
});

Deno.test("старую пометку человека или с причиной не снимаем", () => {
  const byHuman = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: false, reason: null } }));
  assertEquals(byHuman.clearCarry, false);
  const withReason = planPlacement(
    input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: "ждём поставщика" } }),
  );
  assertEquals(withReason.clearCarry, false);
  const blank = planPlacement(input({ due: "2026-10-30", carry: { to_carry: true, auto: true, reason: "   " } }));
  assertEquals(blank.clearCarry, true, "пробелы — это пустая причина");
});

Deno.test("срок за концом идущего, плана нет: задача переезжает в спринт срока, в идущем снимок", () => {
  const p = planPlacement(input({ due: "2026-11-20" }));
  assertEquals(p.move, { from: "A", targetCycleId: "F2", snapshot: true });
  assertEquals(p.create, []);
  assertEquals(p.extendTo, null);
});

Deno.test("срок за концом идущего, план до F1, срок в F2: план продлён, идущий живой", () => {
  const p = planPlacement(input({ due: "2026-11-20", draftIds: ["F1"] }));
  assertEquals(p.move, null, "задача продолжается, а не переносится");
  assertEquals(p.extendTo, "F2");
  assertEquals(p.removeDraftIds, []);
});

Deno.test("срок внутри плана: строки не трогаются", () => {
  const p = planPlacement(input({ due: "2026-11-10", draftIds: ["F1", "F2"] }));
  assertEquals(p.move, null);
  assertEquals(p.extendTo, null);
  assertEquals(p.removeDraftIds, []);
  const before = planPlacement(input({ due: "2026-11-10", draftIds: ["F2"] }));
  assertEquals(before.extendTo, null, "срок раньше конца плана — план остаётся, спринты после срока подсветит доска");
  assertEquals(before.removeDraftIds, []);
});

Deno.test("план продлевается за все спринты: недостающие создаются, продление до последнего", () => {
  const p = planPlacement(input({ due: "2026-12-20", draftIds: ["F1"] }));
  assertEquals(p.create.length, 2);
  assertEquals(p.extendTo, newCycleRef(1));
});

Deno.test("задача в будущем G, срок попал в F — строка переставляется, дублей нет", () => {
  const p = planPlacement(input({ due: "2026-11-10", ...notInActive, draftIds: ["F2"] }));
  assertEquals(p.move, { from: "F2", targetCycleId: "F1", snapshot: false });
  assertEquals(p.removeDraftIds, []);
});

Deno.test("задача уже в спринте своего срока — её там и оставляем", () => {
  const p = planPlacement(input({ due: "2026-11-10", ...notInActive, draftIds: ["F1"] }));
  assertEquals(p.move, null);
  assertEquals(p.removeDraftIds, []);
});

Deno.test("снимок в идущем, срок ушёл дальше цели: строка цели переставляется (ссылка снимка живёт)", () => {
  const p = planPlacement(
    input({ due: "2026-11-20", activeRow: "snapshot", draftIds: ["F1"], snapshotTargetId: "F1" }),
  );
  assertEquals(p.move, { from: "F1", targetCycleId: "F2", snapshot: false });
  assertEquals(p.revive, false);
});

Deno.test("срок дальше всех спринтов: создаются все промежуточные подряд, задача в последнем", () => {
  const p = planPlacement(input({ due: "2026-12-20" }));
  assertEquals(p.create.map((c) => c.name), [
    "Спринт 7 · 01.12 — 14.12",
    "Спринт 8 · 15.12 — 28.12",
  ]);
  assertEquals(p.create.map((c) => c.start_date), ["2026-12-01", "2026-12-15"]);
  assertEquals(p.create[1].check_date, "2026-12-21");
  assertEquals(p.move, { from: "A", targetCycleId: newCycleRef(1), snapshot: true });
});

Deno.test("срок ровно в последний день созданного спринта — без лишнего ещё одного", () => {
  const p = planPlacement(input({ due: "2026-12-14" }));
  assertEquals(p.create.length, 1);
});

Deno.test("опечатка в сроке (2036): спринтов нет, задача не переехала, снимка нет", () => {
  const p = planPlacement(input({ due: "2036-10-25" }));
  assertEquals(p.create, []);
  assertEquals(p.move, null);
  assertEquals(p.limited, true);
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
  const p = planPlacement(input({ due: "2026-12-20", cycles: [old], ...notInActive, draftIds: ["O"] }));
  assertEquals(p.create, []);
  assertEquals(p.limited, true);
  assertEquals(p.move, null);
});

Deno.test("срок в зазоре между спринтами (дыра заведена руками) — не создаём и не двигаем", () => {
  const gap: PlacementCycle = { ...F2, start_date: "2026-11-24", end_date: "2026-12-07" };
  const p = planPlacement(
    input({ due: "2026-11-20", cycles: [A, F1, gap], ...notInActive, draftIds: ["F1"] }),
  );
  assertEquals(p.move, null);
  assertEquals(p.create, []);
  assertEquals(p.removeDraftIds, [], "задача остаётся где была");
});

Deno.test("идущего спринта нет: строка переставляется между запланированными", () => {
  const p = planPlacement(
    input({ due: "2026-11-20", cycles: [F1, F2], ...notInActive, draftIds: ["F1"] }),
  );
  assertEquals(p.move, { from: "F1", targetCycleId: "F2", snapshot: false });
  assertEquals(p.addToActive, false);
});

Deno.test("идущего нет, срок раньше всех спринтов — ничего", () => {
  const p = planPlacement(
    input({ due: "2026-10-01", cycles: [F1, F2], ...notInActive, draftIds: ["F1"] }),
  );
  assertEquals(p.move, null);
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
  const p = planPlacement(input({ due: "2026-11-10", cycles: [done, A] }));
  assertEquals(p.create.map((c) => c.name), [
    "Спринт 5 · 03.11 — 16.11",
  ]);
  assertEquals(p.move, { from: "A", targetCycleId: newCycleRef(0), snapshot: true });
});
