import { assertEquals, assertRejects } from "@std/assert";
import { createTaskLifecycleApi } from "./taskLifecycleApi.ts";
import type { Task } from "../types.ts";

Deno.test("814 lifecycle API sends exact immutable task id and boolean, never status/date fields", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const api = createTaskLifecycleApi(<T>(path: string, init?: RequestInit) => {
    calls.push([path, init]);
    return Promise.resolve({ id: "fictional" } as T);
  });
  await api.setTaskFrozen("fictional", true);
  await api.setTaskFrozen("fictional", false);
  await api.fetchArchivedTasks();
  await api.restoreTask("fictional");
  await api.permanentlyDeleteTask("fictional");
  await api.deleteTask("fictional");
  assertEquals(calls, [
    ["/tasks/fictional/freeze", { method: "POST", body: '{"frozen":true}' }],
    ["/tasks/fictional/freeze", { method: "POST", body: '{"frozen":false}' }],
    ["/tasks/archived", undefined],
    ["/tasks/fictional/restore", { method: "POST" }],
    ["/tasks/fictional/permanent", { method: "DELETE" }],
    ["/tasks/fictional", { method: "DELETE" }],
  ]);
});

Deno.test("814 isolated demo lifecycle preserves task and recurrence on freeze/archive/restore; only archived deletes", async () => {
  let tasks = [{ id: "fictional", title: "Fictional", status: "open", due_date: "2026-11-20", recur_freq: "weekly" } as Task];
  const initial = structuredClone(tasks[0]);
  const api = createTaskLifecycleApi(() => { throw new Error("Unexpected network"); }, { get: () => tasks, set: (next) => { tasks = next; } });
  await assertRejects(() => api.permanentlyDeleteTask("fictional"));
  await api.setTaskFrozen("fictional", true);
  assertEquals([tasks[0].status, tasks[0].due_date, tasks[0].recur_freq], [initial.status, initial.due_date, initial.recur_freq]);
  await api.deleteTask("fictional");
  assertEquals(tasks, []);
  assertEquals((await api.fetchArchivedTasks())[0].title, initial.title);
  await api.restoreTask("fictional");
  await api.setTaskFrozen("fictional", false);
  assertEquals(tasks[0].frozen_at, null);
  await api.deleteTask("fictional");
  await api.permanentlyDeleteTask("fictional");
  assertEquals(await api.fetchArchivedTasks(), []);
});
