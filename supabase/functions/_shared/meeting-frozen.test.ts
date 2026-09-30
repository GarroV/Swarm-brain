// Правило «правленное человеком или опубликованное команде не трогает никто» — одно на все пути
// записи встречи (claim, ingest, очередь, процессор). Ядро: от него зависит, перепишет ли
// автоматика то, что команда уже читает как факт.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFrozen, unfrozen } from "./meeting-frozen.ts";

Deno.test("черновик без правок — не заморожен", () => {
  assertEquals(isFrozen({ notes_edited_at: null, status: "awaiting_review" }), false);
});

Deno.test("опубликованная команде встреча заморожена, даже без правок человека", () => {
  assertEquals(isFrozen({ notes_edited_at: null, status: "in_base" }), true);
});

Deno.test("правленная человеком встреча заморожена", () => {
  assertEquals(isFrozen({ notes_edited_at: "2026-09-28T10:00:00Z", status: "awaiting_review" }), true);
});

Deno.test("строка без поля status (старый select) — решает правка", () => {
  assertEquals(isFrozen({ notes_edited_at: null }), false);
  assertEquals(isFrozen({ notes_edited_at: "2026-09-28T10:00:00Z" }), true);
});

Deno.test("unfrozen добавляет к записи оба условия: без правок и не опубликована", () => {
  const applied: string[] = [];
  const q = {
    is(c: string, v: null) {
      applied.push(`${c}=is.${v}`);
      return q;
    },
    neq(c: string, v: string) {
      applied.push(`${c}=neq.${v}`);
      return q;
    },
  };
  unfrozen(q);
  assertEquals(applied.sort(), ["notes_edited_at=is.null", "status=neq.in_base"]);
});
