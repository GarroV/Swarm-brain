import { assert, assertEquals } from "jsr:@std/assert@1";
import { deltaOrFilter } from "../_shared/tasks/delta.ts";
import { deltaColumns, parseSince } from "./tasks-delta.ts";

Deno.test("parseSince: валидная дата приводится к каноническому ISO", () => {
  assertEquals(parseSince("2026-10-13T10:00:00Z"), "2026-10-13T10:00:00.000Z");
  assertEquals(parseSince("2026-10-13T12:00:00+02:00"), "2026-10-13T10:00:00.000Z");
});

Deno.test("parseSince: нет параметра или не дата — null", () => {
  assertEquals(parseSince(null), null);
  assertEquals(parseSince(""), null);
  assertEquals(parseSince("вчера"), null);
});

Deno.test("parseSince: инъекция в PostgREST-фильтр не проходит", () => {
  // Сырой ввод ушёл бы в .or(...) и дописал бы чужое условие.
  assertEquals(parseSince("2026-10-13T10:00:00Z,group_id.neq.x"), null);
  assertEquals(parseSince("x),archived_at.is.null,(y"), null);
});

Deno.test("deltaOrFilter: ловит и правки, и архивацию (archivePatch updated_at не трогает)", () => {
  const f = deltaOrFilter("2026-10-13T10:00:00.000Z");
  assert(f.includes("updated_at.gt.2026-10-13T10:00:00.000Z"));
  assert(f.includes("archived_at.gt.2026-10-13T10:00:00.000Z"));
});

Deno.test("deltaColumns: к проекции списка добавляется archived_at", () => {
  assertEquals(deltaColumns("id,title"), "id,title,archived_at");
});
