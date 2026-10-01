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

// ── Обзорные инструменты ассистента: дайджест, страны, поиск по стране ─────────────────────
// Каждый запрос к entries — со своим воркспейсом и фильтром видимости (общие, свои и
// разделённые со мной, #641); RPC поиска получают смотрящего, нечёткий поиск по стране — ещё и
// воркспейс (решение владельца 01.10.2026: бот «должен уметь» искать по стране).
function toolBody(src: string, name: string): string {
  const start = src.indexOf(`case "${name}": {`);
  if (start < 0) throw new Error(`инструмент ${name} не найден — детектор устарел`);
  const end = src.indexOf("\n      case ", start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

function overviewProblems(src: string, name: string): string[] {
  const body = toolBody(src, name);
  const problems: string[] = [];
  const reads = body.match(/\.from\("entries"\)[\s\S]*?;/g) ?? [];
  for (const q of reads) {
    if (!q.includes('.eq("group_id", groupId)')) problems.push(`${name}: запрос к entries без воркспейса`);
    if (!/\.or\(visibilityFilter\(userId( \|\| 0)?\)\)/.test(q)) problems.push(`${name}: запрос без фильтра видимости`);
  }
  for (const call of body.match(/\.rpc\("match_entries", \{[\s\S]*?\}\)/g) ?? []) {
    if (!call.includes("requesting_user_id")) problems.push(`${name}: match_entries без смотрящего`);
  }
  for (const call of body.match(/\.rpc\("search_entries_by_country", \{[\s\S]*?\}\)/g) ?? []) {
    if (!call.includes("p_group_id: groupId") || !call.includes("requesting_user_id")) {
      problems.push(`${name}: поиск по стране без воркспейса или смотрящего`);
    }
  }
  return problems;
}

for (const name of ["get_digest", "get_countries_list", "get_entries_by_country", "search_by_country"]) {
  Deno.test(`${name} в боте: свой воркспейс и фильтр видимости`, async () => {
    const src = await Deno.readTextFile(`${HERE}knowledge.ts`);
    assertEquals(overviewProblems(src, name), []);
  });
}

Deno.test("search_by_country в боте: нечёткий поиск по стране на месте", async () => {
  const src = await Deno.readTextFile(`${HERE}knowledge.ts`);
  assertEquals(toolBody(src, "search_by_country").includes('rpc("search_entries_by_country"'), true);
});

Deno.test("детектор обзорных инструментов ловит запрос без воркспейса", () => {
  const broken = `case "get_digest": {
        const { data } = await supabase.from("entries").select("x").order("created_at");
      }
      case "next": {`;
  assertEquals(overviewProblems(broken, "get_digest").length > 0, true);
});
