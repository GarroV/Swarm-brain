import { assertEquals } from "@std/assert";
import { archiveProjectPreview } from "./projectArchive.ts";

const projects = [
  { id: "parent", parent_id: null },
  { id: "child", parent_id: "parent" },
  { id: "other", parent_id: null },
  { id: "other-child", parent_id: "other" },
];

Deno.test("archiving a project removes its children instead of promoting them", () => {
  assertEquals(archiveProjectPreview(projects, "parent"), projects.slice(2));
  assertEquals(projects[1].parent_id, "parent");
});

Deno.test("archiving a subproject preserves its parent and unrelated projects", () => {
  assertEquals(archiveProjectPreview(projects, "child"), [
    projects[0],
    ...projects.slice(2),
  ]);
});
