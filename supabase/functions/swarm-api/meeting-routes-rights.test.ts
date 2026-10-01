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
  return problems;
}

Deno.test("PATCH/DELETE /meetings/:id и resummarize проверяют права встречи", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  assertEquals(meetingRouteProblems(src), []);
});
