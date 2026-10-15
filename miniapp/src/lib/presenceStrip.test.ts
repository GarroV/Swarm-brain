import { assertEquals } from "jsr:@std/assert@1";
import { orderForStrip, parseStrip, sectionLabel, splitVisible, stripSignature, tooltipText } from "./presenceStrip.ts";
import type { StripPerson } from "./presenceStrip.ts";

const p = (key: string, state: "active" | "idle", section = "tasks"): StripPerson => ({
  key,
  animal: 1,
  style: 2,
  section,
  state,
});

Deno.test("разбор ответа: мусор отбрасывается, годное остаётся", () => {
  assertEquals(parseStrip(null), null);
  assertEquals(parseStrip({ window: "x", people: [] }), null);
  const out = parseStrip({
    window: 7,
    people: [
      { key: "1-2", animal: 1, style: 2, section: "tasks", state: "active" },
      { key: "1-2", animal: 1.5, style: 2, section: "tasks", state: "active" },
      { key: "3-4", animal: 3, style: 4, section: "home", state: "away" },
      "x",
    ],
  });
  assertEquals(out?.people.length, 1);
});

Deno.test("порядок: активные первыми, внутри группы порядок сохраняется", () => {
  const out = orderForStrip([p("a", "idle"), p("b", "active"), p("c", "idle"), p("d", "active")]);
  assertEquals(out.map((x) => x.key), ["b", "d", "a", "c"]);
});

Deno.test("до N кружков, остальные счётчиком", () => {
  const list = ["a", "b", "c", "d", "e", "f", "g"].map((k) => p(k, "active"));
  assertEquals(splitVisible(list, 5).rest, 2);
  assertEquals(splitVisible(list, 3).shown.length, 3);
  assertEquals(splitVisible(list.slice(0, 2), 5).rest, 0);
});

Deno.test("раздел словами человека, RU и EN; незнакомый — общая подпись", () => {
  assertEquals(sectionLabel("tasks/mine/today", "ru"), "в задачах");
  assertEquals(sectionLabel("meetings/meetingreview", "en"), "in Meetings");
  assertEquals(sectionLabel("live", "ru"), "на живой встрече");
  assertEquals(sectionLabel("zzz", "ru"), "в SWARM");
  assertEquals(sectionLabel("zzz", "en"), "in SWARM");
});

Deno.test("подсказка: псевдоним, раздел, состояние", () => {
  assertEquals(
    tooltipText({ section: "sprints/x", state: "idle" }, "Сонная выдра", "ru"),
    "Сонная выдра · в спринтах · отошёл",
  );
  assertEquals(
    tooltipText({ section: "market", state: "active" }, "Sleepy Otter", "en"),
    "Sleepy Otter · in Market analysis · working",
  );
});

Deno.test("отпечаток меняется со сменой раздела и состояния, но не от повтора", () => {
  const base = { window: 1, people: [p("a", "active", "tasks")] };
  assertEquals(stripSignature(base), stripSignature({ window: 1, people: [p("a", "active", "tasks")] }));
  assertEquals(stripSignature(base) === stripSignature({ window: 1, people: [p("a", "idle", "tasks")] }), false);
  assertEquals(stripSignature(base) === stripSignature({ window: 1, people: [p("a", "active", "home")] }), false);
});
