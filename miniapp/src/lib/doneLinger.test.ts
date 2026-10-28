// Отметка кружком: строка задерживается (lib/doneLinger.ts), отзыв коллеги 28.10.2026.
import { assert, assertEquals } from "jsr:@std/assert";
import type { Task } from "@/types";
import { restoreLingering, revertLingering } from "./doneLinger";
import { DEFAULT_STATUSES, filterTasks } from "./smartLists";

const mk = (id: string, status: string): Task => ({ id, title: id, status, due_date: "2026-10-28", assignee_telegram_ids: [1] }) as unknown as Task;
const me = { telegram_id: 1 } as never;
const now = new Date("2026-10-28T10:00:00");

const before = mk("a", "open");
const after = mk("a", "done");
const other = mk("b", "open");
const lingering = new Map([["a", before]]);

Deno.test("без задержки выполненная пропадает из открытых", () => {
  const rows = filterTasks([after, other], "today", "mine", me, now, null, DEFAULT_STATUSES);
  assertEquals(rows.map((t) => t.id), ["b"]);
});

Deno.test("с задержкой остаётся в списке и рисуется выполненной", () => {
  const shadow = revertLingering([after, other], lingering);
  const rows = filterTasks(shadow, "today", "mine", me, now, null, DEFAULT_STATUSES);
  const shown = restoreLingering(rows, [after, other], lingering);
  assertEquals(shown.map((t) => [t.id, t.status]), [["a", "done"], ["b", "open"]]);
});

Deno.test("пустая задержка ничего не меняет", () => {
  const list = [after, other];
  assert(revertLingering(list, new Map()) === list);
  assert(restoreLingering(list, list, new Map()) === list);
});
