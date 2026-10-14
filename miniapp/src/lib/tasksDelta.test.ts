import { assertEquals } from "jsr:@std/assert@1";
import { mergeTasksDelta, type DeltaTask } from "./tasksDelta.ts";
import type { Task } from "@/types";

const t = (id: string, title: string, extra: Partial<DeltaTask> = {}): DeltaTask =>
  ({ id, title, ...extra }) as DeltaTask;

Deno.test("слияние: изменённая задача заменяется на месте, остальные не тронуты", () => {
  const cur = [t("1", "a"), t("2", "b"), t("3", "c")] as Task[];
  const next = mergeTasksDelta(cur, [t("2", "b2")]);
  assertEquals(next.map((x) => x.title), ["a", "b2", "c"]);
});

Deno.test("слияние: новая задача встаёт в начало", () => {
  const next = mergeTasksDelta([t("1", "a")] as Task[], [t("9", "new")]);
  assertEquals(next.map((x) => x.id), ["9", "1"]);
});

Deno.test("слияние: архивная задача убирается, а новая архивная не появляется", () => {
  const cur = [t("1", "a"), t("2", "b")] as Task[];
  const next = mergeTasksDelta(cur, [t("1", "a", { archived_at: "2026-10-13T00:00:00Z" }), t("7", "z", { archived_at: "2026-10-13T00:00:00Z" })]);
  assertEquals(next.map((x) => x.id), ["2"]);
});

Deno.test("слияние: пустая дельта отдаёт тот же список (без лишнего рендера)", () => {
  const cur = [t("1", "a")] as Task[];
  assertEquals(mergeTasksDelta(cur, []) === cur, true);
});

Deno.test("слияние идемпотентно: та же дельта дважды даёт тот же результат", () => {
  const cur = [t("1", "a"), t("2", "b")] as Task[];
  const d = [t("2", "b2"), t("9", "new"), t("1", "a", { archived_at: "x" })];
  const once = mergeTasksDelta(cur, d);
  assertEquals(mergeTasksDelta(once, d), once);
});
