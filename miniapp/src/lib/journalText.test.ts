import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { journalText } from "./journalText.ts";
import type { JournalEvent } from "../types.ts";

const ru = (r: string, _e: string) => r;
const en = (_r: string, e: string) => e;
const ev = (kind: JournalEvent["kind"], params?: JournalEvent["params"], text = "сервер"): JournalEvent => ({
  at: "2026-10-02T00:00:00Z", kind, actor: null, task_id: null, task_title: null, text, params,
});

Deno.test("журнал: в демо строки спринта английские", () => {
  assertEquals(journalText(ev("item_added", { cycle: "S12" }), en), "Added to S12");
  assertEquals(journalText(ev("cycle_accepted", { cycle: "S12", percent: 80 }), en), "Sprint accepted: S12 — 80% done");
  assertEquals(journalText(ev("check", { status: "risk" }), en), "Check-in: at risk");
  assertEquals(journalText(ev("carry", { reason: null }), en), "To carry over");
  assertEquals(journalText(ev("removed", { cycle: null }), en), "Task deleted; the sprint keeps a mention");
});

Deno.test("журнал: по-русски совпадает с прежним серверным текстом", () => {
  assertEquals(journalText(ev("item_added", { cycle: "S12" }), ru), "Взята в S12");
  assertEquals(journalText(ev("cycle_started", { cycle: "S12" }), ru), "Спринт начат: S12");
  assertEquals(journalText(ev("carry", { reason: "ждём" }), ru), "К переносу: ждём");
});

Deno.test("журнал: без params и для правок задачи — текст сервера как есть", () => {
  assertEquals(journalText(ev("item_added"), en), "сервер");
  assertEquals(journalText(ev("task_change", {}, "status: open → done"), en), "status: open → done");
  assertEquals(journalText(ev("comment", {}, "текст коммента"), en), "текст коммента");
});
