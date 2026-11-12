import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countProjectTasks } from "./project-counts.ts";

Deno.test("countProjectTasks: бэклог — только status=backlog, не «вне дерева» (#1272)", () => {
  const c = countProjectTasks([
    { project_id: "p", status: "open" },
    { project_id: "p", status: "cancelled" },
    { project_id: "p", status: "backlog" },
    { project_id: null, status: "backlog" },
  ]);
  assertEquals(c.get("p"), { total: 3, backlog: 1 });
  assertEquals(c.size, 1);
});
