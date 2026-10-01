// Детектор: ИИ-инструмент бота `update_entry` правит запись только внутри воркспейса и после
// проверки прав (_shared/entries/entry-edit.ts — сами права покрыты его тестом).
// Обработчик без базы и модели не поднять, поэтому правило держится по исходнику.
import { assertEquals } from "jsr:@std/assert@1";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);

function updateEntryProblems(src: string): string[] {
  const start = src.indexOf('case "update_entry": {');
  if (start < 0) throw new Error("инструмент update_entry не найден — детектор устарел");
  const end = src.indexOf("\n      case ", start + 1);
  const body = src.slice(start, end < 0 ? undefined : end);
  const problems: string[] = [];
  const guard = body.indexOf("entryEditError(");
  const write = body.indexOf('.from("entries").update(');
  if (guard < 0) problems.push("нет проверки прав entryEditError");
  if (guard >= 0 && write >= 0 && guard > write) problems.push("проверка прав после записи");
  if (!/if \(denied\) return denied;/.test(body)) problems.push("отказ не прерывает правку");
  const reads = body.match(/\.from\("entries"\)[\s\S]*?;/g) ?? [];
  if (reads.some((q) => !q.includes('.eq("group_id", groupId)'))) {
    problems.push("запрос к entries без воркспейса");
  }
  if (!/changesPrivacy/.test(body)) problems.push("смена видимости без отдельного права");
  return problems;
}

Deno.test("update_entry в боте: воркспейс и права до записи", async () => {
  const src = await Deno.readTextFile(`${HERE}knowledge.ts`);
  assertEquals(updateEntryProblems(src), []);
});

// ── get_recent_meetings: список встреч — свой воркспейс, личные только свои ────
function recentMeetingsProblems(src: string): string[] {
  const start = src.indexOf('case "get_recent_meetings": {');
  if (start < 0) throw new Error("инструмент get_recent_meetings не найден — детектор устарел");
  const query = src.slice(start, src.indexOf("await q;", start));
  const problems: string[] = [];
  if (!/\.eq\("group_id", groupId\)/.test(query)) problems.push("список без воркспейса");
  if (!/\.or\(visibilityFilter\(userId\)\)/.test(query)) problems.push("список без фильтра личных");
  return problems;
}

Deno.test("get_recent_meetings в боте: воркспейс и фильтр личных", async () => {
  const src = await Deno.readTextFile(`${HERE}knowledge.ts`);
  assertEquals(recentMeetingsProblems(src), []);
});

// ── export_entry: запись ищется гардом выгрузки, а не своим запросом рядом ────
Deno.test("export_entry в боте берёт запись через loadEntryForExport", async () => {
  const src = await Deno.readTextFile(`${HERE}knowledge.ts`);
  const start = src.indexOf('if (tc.function.name === "export_entry")');
  if (start < 0) throw new Error("обработка export_entry не найдена — детектор устарел");
  const body = src.slice(start, src.indexOf("} else {\n          result = await executeTool", start));
  assertEquals(body.includes("loadEntryForExport("), true, "выгрузка без гарда");
  assertEquals(/\.from\("entries"\)/.test(body), false, "выгрузка читает entries своим запросом");
});
