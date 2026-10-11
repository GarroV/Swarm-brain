import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createLabel, deleteLabel, labelNameError, mergeOwnLabels, updateLabel } from "./labels.ts";

type Call = [string, string, ...unknown[]];
type Answer = { data: unknown; error: unknown };

/** Подделка базы: ответ выбирается по таблице и последней операции цепочки. */
function fakeDb(answer: (table: string, ops: string[]) => Answer) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const ops: string[] = [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "in", "contains", "maybeSingle", "single"]) {
        b[m] = (...a: unknown[]) => {
          ops.push(m);
          calls.push([table, m, ...a]);
          return b;
        };
      }
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(answer(table, ops)).then(ok);
      return b;
    },
  };
  return { db: db as never, calls };
}

const LABEL = { id: "L1", name: "Срочное", icon: "tag", color: null, sort_order: 0 };

Deno.test("название: пустое и не строка — отказ", () => {
  assertEquals(labelNameError("  "), "Название метки обязательно");
  assertEquals(labelNameError(5), "Название метки обязательно");
  assertEquals(labelNameError("Ок"), null);
});

Deno.test("создание: владелец и воркспейс из вызова, имя обрезано", async () => {
  const { db, calls } = fakeDb(() => ({ data: LABEL, error: null }));
  const r = await createLabel(db, 7, "g1", { name: "  Срочное " });
  assertEquals(r.ok, true);
  const insert = calls.find((c) => c[1] === "insert")!;
  assertEquals(insert[2], { owner_id: 7, group_id: "g1", name: "Срочное", icon: "tag", color: null });
});

Deno.test("создание: пустое имя в базу не идёт", async () => {
  const { db, calls } = fakeDb(() => ({ data: LABEL, error: null }));
  const r = await createLabel(db, 7, "g1", { name: "" });
  assertEquals(r.ok ? 0 : r.status, 400);
  assertEquals(calls, []);
});

Deno.test("переименование чужой метки: «не найдена», запись не выполняется", async () => {
  const { db, calls } = fakeDb(() => ({ data: null, error: null }));
  const r = await updateLabel(db, 7, "L1", { name: "Чужое" });
  assertEquals(r.ok ? 0 : r.status, 404);
  assertEquals(calls.some((c) => c[1] === "update"), false);
  // Проверка владения — по owner_id вызывающего, а не по одному id.
  assertEquals(calls.some((c) => c[1] === "eq" && c[2] === "owner_id" && c[3] === 7), true);
});

Deno.test("переименование своей: запись тоже ограничена owner_id", async () => {
  const { db, calls } = fakeDb(() => ({ data: LABEL, error: null }));
  const r = await updateLabel(db, 7, "L1", { name: " Новое " });
  assertEquals(r.ok, true);
  const afterUpdate = calls.slice(calls.findIndex((c) => c[1] === "update"));
  assertEquals(afterUpdate[0][2], { name: "Новое" });
  assertEquals(afterUpdate.some((c) => c[1] === "eq" && c[2] === "owner_id" && c[3] === 7), true);
});

Deno.test("удаление чужой метки: ни задачи, ни метка не тронуты", async () => {
  const { db, calls } = fakeDb(() => ({ data: null, error: null }));
  const r = await deleteLabel(db, 7, "L1");
  assertEquals(r.ok ? 0 : r.status, 404);
  assertEquals(calls.some((c) => c[1] === "update" || c[1] === "delete"), false);
});

Deno.test("удаление своей: метка снимается со всех задач воркспейса, потом удаляется", async () => {
  const { db, calls } = fakeDb((table, ops) => {
    if (table === "task_labels" && ops.includes("maybeSingle")) {
      return { data: { id: "L1", group_id: "g1" }, error: null };
    }
    if (table === "tasks" && ops.includes("contains")) {
      return { data: [{ id: "T1", label_ids: ["L1", "L2"] }], error: null };
    }
    return { data: null, error: null };
  });
  const r = await deleteLabel(db, 7, "L1");
  assertEquals(r.ok, true);
  assertEquals(calls.find((c) => c[0] === "tasks" && c[1] === "update")?.[2], { label_ids: ["L2"] });
  // Задачи ищутся по самой метке в её воркспейсе, а не среди «задач владельца».
  assertEquals(calls.some((c) => c[0] === "tasks" && c[1] === "eq" && c[2] === "owner_id"), false);
  assertEquals(calls.some((c) => c[0] === "tasks" && c[1] === "eq" && c[2] === "group_id" && c[3] === "g1"), true);
  const del = calls.findIndex((c) => c[0] === "task_labels" && c[1] === "delete");
  assertEquals(del > calls.findIndex((c) => c[0] === "tasks" && c[1] === "update"), true);
  assertEquals(calls.slice(del).some((c) => c[1] === "eq" && c[2] === "owner_id" && c[3] === 7), true);
});

Deno.test("удаление: сбой снятия с задачи останавливает удаление метки", async () => {
  const { db, calls } = fakeDb((table, ops) => {
    if (table === "task_labels") return { data: { id: "L1" }, error: null };
    if (ops.includes("contains")) return { data: [{ id: "T1", label_ids: ["L1"] }], error: null };
    return { data: null, error: { message: "boom" } };
  });
  const r = await deleteLabel(db, 7, "L1");
  assertEquals(r.ok ? 0 : r.status, 500);
  assertEquals(calls.some((c) => c[0] === "task_labels" && c[1] === "delete"), false);
});

// ── Метки на любой задаче (решение 2026-10-09) ────────────────────────────────
// Своя метка — у которой owner_id = вызывающий; чужие на задаче не трогаются.

const MINE = ["M1", "M2"];
const mineDb = () =>
  fakeDb((table) =>
    table === "task_labels" ? { data: MINE.map((id) => ({ id })), error: null } : { data: null, error: null }
  );

Deno.test("метки: свои ставятся, чужие на задаче сохраняются, даже если клиент их не прислал", async () => {
  const { db, calls } = mineDb();
  const r = await mergeOwnLabels(db, 7, ["X1", "M1"], ["M2"]);
  assertEquals(r, { ok: true, value: ["X1", "M2"] });
  assertEquals(calls.some((c) => c[1] === "eq" && c[2] === "owner_id" && c[3] === 7), true);
});

Deno.test("метки: чужую метку, которой на задаче нет, поставить нельзя", async () => {
  const { db } = mineDb();
  const r = await mergeOwnLabels(db, 7, [], ["X9"]);
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.status, 400);
});

Deno.test("метки: чужая, присланная эхом с задачи, не отказ и не дубль", async () => {
  const { db } = mineDb();
  assertEquals(await mergeOwnLabels(db, 7, ["X1"], ["X1", "M1"]), { ok: true, value: ["X1", "M1"] });
});

Deno.test("метки: сбой чтения меток — ошибка, а не тихое снятие", async () => {
  const { db } = fakeDb(() => ({ data: null, error: { message: "boom" } }));
  const r = await mergeOwnLabels(db, 7, ["M1"], []);
  assertEquals(!r.ok && r.status, 500);
});
