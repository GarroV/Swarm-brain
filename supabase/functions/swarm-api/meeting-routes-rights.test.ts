// Детектор дрифта: правка и удаление встречи в swarm-api идут через права встречи
// (getMeetingSecure, _shared/entries/meeting-rights.ts), а не через одну видимость.
//
// Обычный тест эндпоинта здесь не поможет: index.ts без базы не поднять. Сам гард покрыт
// entries-guard.test.ts, а этот детектор держит, что маршруты зовут именно его, с нужным
// действием.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

/** Тело обработчика метода внутри маршрута /meetings/:id. */
function methodBlock(src: string, method: string): string {
  const route = src.indexOf("const meetingMatch = routePath.match(");
  if (route < 0) throw new Error("маршрут /meetings/:id не найден — детектор устарел");
  const start = src.indexOf(`if (req.method === "${method}")`, route);
  if (start < 0) throw new Error(`${method} /meetings/:id не найден — детектор устарел`);
  const next = src.indexOf("if (req.method ===", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

function meetingRouteProblems(src: string): string[] {
  const problems: string[] = [];
  const patch = methodBlock(src, "PATCH");
  if (!/getMeetingSecure\([\s\S]*?action: "edit"/.test(patch)) problems.push("PATCH без права edit");
  if (!/canChangeMeetingPrivacy\(/.test(patch)) problems.push("PATCH меняет видимость без проверки");
  const del = methodBlock(src, "DELETE");
  if (!/getMeetingSecure\([\s\S]*?action: "delete"/.test(del)) problems.push("DELETE без права delete");
  const resStart = src.indexOf("if (meetingResummarizeMatch");
  const resum = src.slice(resStart, src.indexOf("\n  }\n", resStart));
  if (!/getMeetingSecure\([\s\S]*?action: "edit"/.test(resum)) problems.push("resummarize без права edit");
  // Согласование — только признак согласования: ни видимость, ни владелец (см. meeting-confirm.ts).
  if (!/meetingConfirmPatch\(/.test(patch)) problems.push("PATCH confirmed не через meetingConfirmPatch");
  const confirmBlock = patch.slice(patch.indexOf('"confirmed" in body'), patch.indexOf('"summary" in body'));
  if (/is_private|owner_id|shared_with/.test(confirmBlock.replace(/\/\/.*$/gm, ""))) {
    problems.push("confirmed меняет видимость или владельца");
  }
  // Правка встречи никогда не назначает владельца: запись без владельца остаётся без владельца.
  if (/fields\.owner_id/.test(patch.replace(/\/\/.*$/gm, ""))) problems.push("PATCH назначает владельца встрече");
  // Права встречи — только на встречи: GET, notes и ask отдают 404 на не-встречу.
  const get = methodBlock(src, "GET");
  if (!/requireMeeting: true/.test(get)) problems.push("GET /meetings/:id отдаёт не-встречу");
  const notesStart = src.indexOf("if (meetingNotesMatch");
  const notes = src.slice(notesStart, src.indexOf("getEntrySecure", notesStart) + 200);
  if (!/requireMeeting: true/.test(notes)) problems.push("GET /meetings/:id/notes отдаёт не-встречу");
  return problems;
}

Deno.test("PATCH/DELETE /meetings/:id и resummarize проверяют права встречи", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  assertEquals(meetingRouteProblems(src), []);
});

Deno.test("детектор ловит согласование, которое меняет видимость", () => {
  const broken = `
    const meetingMatch = routePath.match(/^\\/meetings\\/([^/]+)$/);
    if (req.method === "GET") { getEntrySecure(s, id, { requireMeeting: true }); }
    if (req.method === "PATCH") {
      getMeetingSecure(s, id, { action: "edit" });
      if ("confirmed" in body) { fields.is_private = false; }
      meetingConfirmPatch(entry.metadata);
      canChangeMeetingPrivacy(entry, v);
      if ("summary" in body) {}
    }
    if (req.method === "DELETE") { getMeetingSecure(s, id, { action: "delete" }); }
  `;
  assertEquals(meetingRouteProblems(broken).includes("confirmed меняет видимость или владельца"), true);
});
