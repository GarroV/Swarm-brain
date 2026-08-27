// Раннер тот же, что у остальных edge-тестов: deno test -A supabase/functions/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createJsonObjectScanner } from "./json-object-stream.ts";

// Модель отдаёт JSON-массив задач токен за токеном. Сканер выдёргивает КАЖДЫЙ объект в тот
// момент, когда он дописан, — на этом держится показ задач по одной, а не пачкой в конце.

const ARRAY = `[{"title":"Первая","due_date":null},{"title":"Вторая","country":"RS"}]`;

Deno.test("массив целиком одним куском — оба объекта", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push(ARRAY), [
    `{"title":"Первая","due_date":null}`,
    `{"title":"Вторая","country":"RS"}`,
  ]);
});

Deno.test("посимвольная подача даёт ТОТ ЖЕ результат — иначе разбор зависел бы от нарезки сети", () => {
  const scan = createJsonObjectScanner();
  const out: string[] = [];
  for (const ch of ARRAY) out.push(...scan.push(ch));
  assertEquals(out, [
    `{"title":"Первая","due_date":null}`,
    `{"title":"Вторая","country":"RS"}`,
  ]);
});

Deno.test("объект отдаётся РОВНО когда дописан, а не когда закрылся массив", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push(`[{"title":"Первая"}`), [`{"title":"Первая"}`]);
  assertEquals(scan.push(`,{"title":"Вторая"`), []);
  assertEquals(scan.push(`}]`), [`{"title":"Вторая"}`]);
});

Deno.test("фигурные скобки ВНУТРИ строки объект не разрывают", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push(`[{"title":"Шаблон {name} и {city}"}]`), [`{"title":"Шаблон {name} и {city}"}`]);
});

Deno.test("экранированная кавычка внутри строки не сбивает состояние", () => {
  const scan = createJsonObjectScanner();
  const src = `[{"title":"Сказал \\"да\\" и ушёл","description":"тут } скобка"}]`;
  assertEquals(scan.push(src), [`{"title":"Сказал \\"да\\" и ушёл","description":"тут } скобка"}`]);
});

Deno.test("экранированный обратный слэш перед кавычкой не съедает закрытие строки", () => {
  const scan = createJsonObjectScanner();
  const src = `[{"title":"путь C:\\\\","country":"RS"}]`;
  assertEquals(scan.push(src), [`{"title":"путь C:\\\\","country":"RS"}`]);
});

Deno.test("вложенный объект отдаётся ОДНИМ куском, а не двумя", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push(`[{"title":"A","meta":{"x":1}}]`), [`{"title":"A","meta":{"x":1}}`]);
});

Deno.test("markdown-обёртка от модели игнорируется", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push('```json\n[{"title":"A"}]\n```'), [`{"title":"A"}`]);
});

Deno.test("оборванный хвост не отдаётся — половина задачи хуже, чем её отсутствие", () => {
  const scan = createJsonObjectScanner();
  assertEquals(scan.push(`[{"title":"Готовая"},{"title":"Обор`), [`{"title":"Готовая"}`]);
  assertEquals(scan.push(""), []);
});

Deno.test("пустой массив и мусор вокруг ничего не выдают", () => {
  assertEquals(createJsonObjectScanner().push("[]"), []);
  assertEquals(createJsonObjectScanner().push("  \n , , \n "), []);
  assertEquals(createJsonObjectScanner().push(""), []);
});
