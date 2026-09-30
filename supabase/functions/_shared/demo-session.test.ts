// Демо — это ЛИЧНОСТЬ (демо-пользователь секретной ссылки), а не слаг воркспейса: проект запрещает
// решать что-либо по конкретному group_id (CLAUDE.md, §Идентификаторы). Слаг меняется или
// строка демо-человека лежит в другой группе — и отказ «из демо нельзя» молча перестаёт работать.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEMO_GROUP_ID, DEMO_USER_ID, isDemoSession } from "./demo-session.ts";

Deno.test("isDemoSession: демо-пользователь — демо, в какой бы группе ни лежала его строка", () => {
  assertEquals(isDemoSession(DEMO_USER_ID), true);
});

Deno.test("isDemoSession: обычный человек — не демо, даже в группе со слагом демо", () => {
  assertEquals(isDemoSession(744230399), false);
  assertEquals(isDemoSession(DEMO_USER_ID + 1), false);
});

Deno.test("DEMO_GROUP_ID — синтетическая группа демо-сессии, не пустая", () => {
  assert(DEMO_GROUP_ID.length > 0);
});

/** Рабочий код всех функций: демо решается одной функцией, а не сравнением group_id со слагом. */
Deno.test("никто не решает «это демо» сравнением group_id со строкой", async () => {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const offenders: string[] = [];
  const bySlug = /\b(group_?id|groupId)\s*[!=]==?\s*["'`]demo["'`]/i;
  for await (const dir of Deno.readDir(root)) {
    if (!dir.isDirectory) continue;
    for await (const f of Deno.readDir(`${root}${dir.name}`)) {
      if (!f.isFile || !f.name.endsWith(".ts") || f.name.endsWith(".test.ts")) {
        continue;
      }
      const text = await Deno.readTextFile(`${root}${dir.name}/${f.name}`);
      text.split("\n").forEach((line, i) => {
        if (bySlug.test(line)) {
          offenders.push(`${dir.name}/${f.name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assertEquals(
    offenders,
    [],
    "демо решайте isDemoSession(telegramId) из _shared/demo-session.ts",
  );
});
