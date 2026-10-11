import { assertEquals } from "jsr:@std/assert@1";
import { PRESENCE_PULSE_MS, presenceSection, shouldPulse } from "./presence.ts";

Deno.test("раздел: таб и экран из адреса, человеческими именами", () => {
  assertEquals(presenceSection("/", "", null), "home");
  assertEquals(presenceSection("/", "?tab=cal", null), "meetings");
  assertEquals(presenceSection("/", "?tab=task&view=taskDetail&id=t-1", null), "tasks/taskdetail");
  assertEquals(presenceSection("/", "?meeting=m-1", null), "meetings/meetingreview");
  assertEquals(presenceSection("/live", "?meeting=m-1", null), "live");
});

Deno.test("раздел: на странице входа пульса нет", () => {
  assertEquals(presenceSection("/login", "?next=%2F", null), null);
});

Deno.test("доска задач: линза и список из сохранённого вида", () => {
  const view = JSON.stringify({ lens: "team", activeList: "upcoming" });
  assertEquals(presenceSection("/", "?tab=task", view), "tasks/team/upcoming");
  const staff = JSON.stringify({ lens: "mine", activeList: "today", allStaff: true });
  assertEquals(presenceSection("/", "?tab=task", staff), "tasks/staff/today");
  // Мусор в хранилище не попадает в раздел.
  assertEquals(presenceSection("/", "?tab=task", '{"lens":"<x>"}'), "tasks");
  assertEquals(presenceSection("/", "?tab=task", "not json"), "tasks");
});

Deno.test("пульс: сразу на смене раздела и возврате к вводу, иначе раз в 30 с", () => {
  const t0 = 1_000_000;
  const memo = { section: "tasks", active: false, at: t0 };
  assertEquals(shouldPulse(null, "tasks", false, t0), true);
  assertEquals(shouldPulse(memo, "tasks", false, t0 + 2_000), false);
  assertEquals(shouldPulse(memo, "meetings", false, t0 + 2_000), true);
  assertEquals(shouldPulse(memo, "tasks", true, t0 + 2_000), true);
  assertEquals(shouldPulse(memo, "tasks", false, t0 + PRESENCE_PULSE_MS), true);
});
