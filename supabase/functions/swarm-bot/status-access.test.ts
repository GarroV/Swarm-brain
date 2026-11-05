// Детектор: `/status` бота считает и называет встречи общим правилом видимости — пространство по
// признаку принадлежности (или домашнее для очереди подтверждения) и фильтр приватности
// (`visibilityFilter(userId)`): чужая личная встреча не попадает ни в число, ни в названия.
// Обработчик без базы и Telegram не поднять, поэтому правило держится по исходнику.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

export function statusProblems(src: string): string[] {
  const start = src.indexOf('command === "/status"');
  if (start < 0) throw new Error("обработчик /status не найден — детектор устарел");
  const end = src.indexOf("let statusMsg", start);
  if (end < 0) throw new Error("конец запросов /status не найден — детектор устарел");
  const body = src.slice(start, end);
  // Каждый запрос к entries — от `onlyLiveEntries(` (с обёрткой visibleInWorkspace) до следующего
  // запроса или конца Promise.all.
  const parts = body
    .split(
      /(?=visibleInWorkspace\(\s*onlyLiveEntries\(supabase\.from\("entries"\))|(?<!visibleInWorkspace\(\s*)(?=onlyLiveEntries\(supabase\.from\("entries"\))/,
    )
    .slice(1);
  if (parts.length === 0) return ["/status: запросов к entries не найдено — детектор устарел"];
  const problems: string[] = [];
  parts.forEach((q, i) => {
    const scoped = q.includes('.eq("group_id", groupId)') ||
      (/^visibleInWorkspace\(/.test(q) && /,\s*groupId,?\s*\)/.test(q));
    if (!scoped) problems.push(`/status: запрос ${i + 1} к entries без пространства`);
    if (!/\.or\(visibilityFilter\(userId\)\)/.test(q)) problems.push(`/status: запрос ${i + 1} без фильтра видимости`);
  });
  return problems;
}

Deno.test("/status в боте: пространство и фильтр видимости у каждого запроса встреч", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  assertEquals(statusProblems(src), []);
});

Deno.test("детектор /status ловит запрос без фильтра видимости", () => {
  const broken = `command === "/status") {
    await Promise.all([
      onlyLiveEntries(supabase.from("entries").select("id")).eq("group_id", groupId),
    ]);
    let statusMsg = "";`;
  assertEquals(statusProblems(broken), ["/status: запрос 1 без фильтра видимости"]);
});
