// Детектор дрифта: привязка задачи к проекту в роутере идёт через проверку ВИДИМОСТИ проекта.
//
// Поведение функции проверяет project-bind-access.db.test.ts; здесь — что роутер её зовёт.
// Отдельно потому, что точка привязки — одна строка в большом роутере, и проверка «проект
// в этом воркспейсе» без вызывающего выглядит так же правдоподобно и ничего не роняет.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));
const src = await Deno.readTextFile(`${HERE}index.ts`);

Deno.test("POST и PATCH /tasks проверяют видимость проекта вызывающему", () => {
  const calls = [
    ...src.matchAll(
      /canViewProjectInWorkspace\(\s*(projectId|pid),\s*groupId,\s*telegram_id\s*\)/g,
    ),
  ].map((m) => m[1]);
  assertEquals(calls.sort(), ["pid", "projectId"]);
});
