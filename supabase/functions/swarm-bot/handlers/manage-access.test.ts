// Детектор: управление записью из чата (удалить/заменить) идёт через права действия, и отказ
// прерывает действие. Сами права — _shared/entries/entry-edit.ts (покрыты его тестом);
// обработчик без базы не поднять, поэтому связка держится по исходнику.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`${name} не найдена — детектор устарел`);
  return src.slice(start, src.indexOf("\n}\n", start));
}

function manageProblems(manage: string, storage: string): string[] {
  const problems: string[] = [];
  const del = fnBody(manage, "doDelete");
  const delGuard = del.search(/getManageableEntry\([^)]*"delete"\)/);
  // Удаление записи — архивация (#569), физического delete нет.
  const delWrite = del.indexOf("archiveEntry(");
  if (delWrite < 0 || del.includes(".delete()")) problems.push("удаление записи не через архивацию");
  if (delGuard < 0 || delGuard > delWrite) problems.push("удаление без права delete до записи");

  const rep = fnBody(manage, "doReplace");
  const repGuard = rep.search(/getManageableEntry\([^)]*"edit"\)/);
  const repWrite = rep.indexOf("updateEntryContent(");
  if (repGuard < 0 || repGuard > repWrite) problems.push("замена без права edit до записи");

  const guard = fnBody(storage, "getManageableEntry");
  if (!guard.includes("entryActionError(")) problems.push("гард не проверяет права действия");
  if (!/throw new EntryAccessError/.test(guard.slice(guard.indexOf("entryActionError(")))) {
    problems.push("отказ по правам не прерывает действие");
  }
  return problems;
}

Deno.test("удаление и замена записи из чата проверяют права до записи", async () => {
  const manage = await Deno.readTextFile(`${HERE}manage.ts`);
  const storage = await Deno.readTextFile(`${HERE}../lib/storage.ts`);
  assertEquals(manageProblems(manage, storage), []);
});
