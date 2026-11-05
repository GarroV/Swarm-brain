// Тексты переезда по машинным кодам сервера. Раннер: deno test -A --no-check src/lib/ (см. spacesDict.test.ts).
import { assertEquals } from "@std/assert";
import { spacesText } from "./spacesDict.ts";
import { bodyCode, conflictText, isFinalMoveError, moveErrorKey, parseFreshCounts } from "./moveMessages.ts";

const en = (key: Parameters<typeof spacesText>[1], vars?: Parameters<typeof spacesText>[2]) => spacesText("en", key, vars);
const ru = (key: Parameters<typeof spacesText>[1], vars?: Parameters<typeof spacesText>[2]) => spacesText("ru", key, vars);

Deno.test("каждый код отказа сервера переводится, неизвестный — общий текст", () => {
  const codes = [
    "person_not_found", "workspace_not_found", "same_workspace", "person_without_workspace",
    "owner_only", "master_admin_only", "bad_input", "conflicts",
  ];
  for (const c of codes) assertEquals(moveErrorKey(c, "moveFailed") === "moveFailed", false, c);
  assertEquals(moveErrorKey("surprise", "moveFailed"), "moveFailed");
  assertEquals(moveErrorKey(undefined, "moveFailed"), "moveFailed");
});

Deno.test("повтор бессмыслен только для отказов по существу запроса", () => {
  assertEquals(isFinalMoveError("same_workspace"), true);
  assertEquals(isFinalMoveError("conflicts"), false);
  assertEquals(isFinalMoveError(undefined), false);
});

Deno.test("конфликт people_email_taken показывает почту на обоих языках", () => {
  assertEquals(conflictText(ru, "people_email_taken:a@b.co"), "В пространстве уже есть человек с почтой a@b.co");
  assertEquals(conflictText(en, "people_email_taken:a@b.co"), "The space already has a person with e-mail a@b.co");
});

Deno.test("неизвестный конфликт не теряется: код виден как есть", () => {
  assertEquals(conflictText(en, "new_thing:x"), "Unknown reason: new_thing:x");
});

Deno.test("код и свежие счётчики читаются из тела ответа, мусор отбрасывается", () => {
  assertEquals(bodyCode({ code: "bad_input" }), "bad_input");
  assertEquals(bodyCode(null), undefined);
  assertEquals(bodyCode({ code: 5 }), undefined);
  assertEquals(parseFreshCounts({ counts: { tasks: 3 } }), { tasks: 3 });
  assertEquals(parseFreshCounts({ counts: [1] }), null);
  assertEquals(parseFreshCounts("x"), null);
});
