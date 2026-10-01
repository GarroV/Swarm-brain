// Детектор дрифта на правило «5xx — клиенту только наш текст» (issue #584, канон —
// ARCHITECTURE §swarm-api, обработка ошибок). Неожиданная ошибка уходит клиенту общей фразой
// через serverError (client-error.ts); подробность — в лог. Правило нельзя закрыть юнит-тестом
// модуля: точек ответа сотни, и новая `apiErr(500, error.message, origin)` появляется одной
// строкой и не ломает ни одного теста — экран просто показывает человеку текст базы.
//
// Проверка: у каждого ответа apiErr(5xx, …) и json({ error: … }, 5xx) текст — строковый
// литерал (или INTERNAL_ERROR_MESSAGE), а не выражение из пойманной ошибки.
import { assertEquals } from "jsr:@std/assert@1";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);

// Известные исключения: место в защищённом разделе («Проекты», .github/protected-paths.txt),
// который правится только по отдельной просьбе владельца. Счёт точный: новое место того же
// вида всё равно уронит тест.
const KNOWN: Record<string, string[]> = {
  "index.ts": ["e instanceof Error ? e.message : String(e)"], // POST /sprints
};

const LITERAL = /^(?:"[^"]*"|'[^']*'|`[^`$]*`|INTERNAL_ERROR_MESSAGE)$/;

/** Тексты 5xx-ответов файла, которые не являются литералом. */
function nonLiteral5xx(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/apiErr\(\s*5\d\d\s*,\s*([^;]*?)\s*,\s*(?:ctx\.)?origin\s*,?\s*\)/g)) {
    if (!LITERAL.test(m[1])) out.push(m[1]);
  }
  for (const m of src.matchAll(/json\(\s*\{\s*error:\s*([^;]*?)\s*\}\s*,\s*5\d\d\b/g)) {
    if (!LITERAL.test(m[1])) out.push(m[1]);
  }
  return out;
}

Deno.test("детектор ловит сырой текст ошибки и пропускает литерал", () => {
  assertEquals(nonLiteral5xx("if (error) return apiErr(500, error.message, origin);"), ["error.message"]);
  assertEquals(nonLiteral5xx("return json({ error: `failed: ${e.message}` }, 500, ctx.origin);"), [
    "`failed: ${e.message}`",
  ]);
  assertEquals(nonLiteral5xx('return apiErr(\n  500,\n  e instanceof Error ? e.message : "x",\n  origin,\n);'), [
    'e instanceof Error ? e.message : "x"',
  ]);
  assertEquals(nonLiteral5xx('return apiErr(500, "GPT error", origin);'), []);
  assertEquals(nonLiteral5xx('return json({ error: "Не удалось" }, 500, origin);'), []);
  assertEquals(nonLiteral5xx("return apiErr(404, e.message, origin);"), []);
});

Deno.test("в swarm-api 5xx-ответы не несут текст пойманной ошибки", async () => {
  const offenders: string[] = [];
  let scanned = 0;
  for await (const f of Deno.readDir(HERE)) {
    if (!f.isFile || !f.name.endsWith(".ts") || f.name.endsWith(".test.ts")) continue;
    scanned++;
    const found = nonLiteral5xx(await Deno.readTextFile(HERE + f.name));
    const known = [...(KNOWN[f.name] ?? [])];
    for (const expr of found) {
      const at = known.indexOf(expr);
      if (at >= 0) known.splice(at, 1);
      else offenders.push(`${f.name}: ${expr}`);
    }
    // Исключение исчезло из кода — убрать его и отсюда, иначе оно прикроет новое место.
    for (const expr of known) offenders.push(`${f.name}: исключение больше не нужно — ${expr}`);
  }
  // Пустой каталог = проверка ничего не проверила; молчать об этом нельзя.
  assertEquals(scanned > 10, true, `просканировано файлов: ${scanned}`);
  assertEquals(offenders, [], "5xx с текстом пойманной ошибки — используй serverError (client-error.ts)");
});
