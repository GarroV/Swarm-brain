// Детектор: личный дайджест бота (/digest и рассылка по крону) собирает записи только видимые
// тому, кому он строится, и сам ложится в базу личной записью этого человека — дайджест пересказывает
// его собственные личные записи, а общий список их показал бы всем.
// Обработчик без базы и модели не поднять, поэтому правило держится по исходнику.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

export function digestProblems(src: string): string[] {
  const start = src.indexOf("export async function generatePersonalDigest(");
  if (start < 0) throw new Error("generatePersonalDigest не найден — детектор устарел");
  const end = src.indexOf("\nexport async function ", start + 1);
  const body = src.slice(start, end < 0 ? undefined : end);
  const problems: string[] = [];
  const reads = body.match(/\.from\("entries"\)[\s\S]*?\.limit\(\d+\);/g) ?? [];
  if (reads.length === 0) problems.push("чтение записей не найдено — детектор устарел");
  for (const q of reads) {
    if (!q.includes('.eq("group_id", groupId)')) problems.push("записи без воркспейса");
    if (!/\.or\(visibilityFilter\(userId\)\)/.test(q)) problems.push("записи без фильтра личных");
  }
  const save = body.match(/saveEntry\(([\s\S]*?)\);/);
  if (!save) problems.push("сохранение дайджеста не найдено — детектор устарел");
  else if (!/groupId,\s*true,\s*userId/.test(save[1].replace(/\/\/[^\n]*/g, ""))) {
    problems.push("дайджест сохраняется не личной записью");
  }
  return problems;
}

Deno.test("дайджест бота: только видимые записи, сам — личная запись", async () => {
  const src = await Deno.readTextFile(`${HERE}digest.ts`);
  assertEquals(digestProblems(src), []);
});
