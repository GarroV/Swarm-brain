// deno test --allow-read miniapp/src/lib/tezisyLines.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyAskAnswer, findLineOf, insertAfter, linesToTezisy, tezisyToLines } from "./tezisyLines.ts";

const SAMPLE = "### Поставщики\n- Анна предложила сменить поставщика сыра\n- Срок — до 15.10\n\n" +
  "### Решения и договорённости\n- Боб готовит сравнение цен";

Deno.test("разбор: заголовки и пункты становятся строками редактора", () => {
  assertEquals(tezisyToLines(SAMPLE), [
    { kind: "heading", text: "Поставщики" },
    { kind: "bullet", text: "Анна предложила сменить поставщика сыра" },
    { kind: "bullet", text: "Срок — до 15.10" },
    { kind: "heading", text: "Решения и договорённости" },
    { kind: "bullet", text: "Боб готовит сравнение цен" },
  ]);
});

Deno.test("туда и обратно: канонический текст тезисов не меняется ни на символ", () => {
  assertEquals(linesToTezisy(tezisyToLines(SAMPLE)), SAMPLE);
});

Deno.test("туда и обратно: абзац без маркера, сноски и жирный сохраняются", () => {
  const src = "Вступление без маркера\n\n### Тема\n- **Итог**: да [2]\n* звёздочка вместо дефиса";
  assertEquals(linesToTezisy(tezisyToLines(src)), "Вступление без маркера\n\n### Тема\n- **Итог**: да [2]\n- звёздочка вместо дефиса");
});

Deno.test("пустые строки редактора не попадают в сохранённый текст", () => {
  assertEquals(
    linesToTezisy([
      { kind: "heading", text: "Тема" },
      { kind: "bullet", text: "  " },
      { kind: "bullet", text: "пункт" },
      { kind: "heading", text: "" },
    ]),
    "### Тема\n- пункт",
  );
});

Deno.test("пустые тезисы открываются одним пустым пунктом, куда можно писать", () => {
  assertEquals(tezisyToLines("  \n"), [{ kind: "bullet", text: "" }]);
});

Deno.test("вставка ответа под строкой не трогает исходный массив", () => {
  const lines = tezisyToLines(SAMPLE);
  const next = insertAfter(lines, 1, [{ kind: "bullet", text: "ответ" }]);
  assertEquals(next[2], { kind: "bullet", text: "ответ" });
  assertEquals(next.length, lines.length + 1);
  assertEquals(lines.length, 5);
});

Deno.test("поиск строки по выделенному тексту: последняя строка, где встречается выделение", () => {
  const lines = tezisyToLines(SAMPLE);
  assertEquals(findLineOf(lines, "сменить поставщика"), 1);
  assertEquals(findLineOf(lines, "Срок — до 15.10\nРешения"), 3);
  assertEquals(findLineOf(lines, "такого нет"), -1);
});

Deno.test("ответ на вопрос: вставка под пунктом, замена пункта, в конец если строку не нашли", () => {
  const lines = tezisyToLines("### Тема\n- старый пункт\n- соседний");
  const answer = "- первый факт\n- второй факт";
  assertEquals(linesToTezisy(applyAskAnswer(lines, 1, answer, "insert")),
    "### Тема\n- старый пункт\n- первый факт\n- второй факт\n- соседний");
  assertEquals(linesToTezisy(applyAskAnswer(lines, 1, answer, "replace")),
    "### Тема\n- первый факт\n- второй факт\n- соседний");
  assertEquals(linesToTezisy(applyAskAnswer(lines, -1, answer, "replace")),
    "### Тема\n- старый пункт\n- соседний\n- первый факт\n- второй факт");
});
