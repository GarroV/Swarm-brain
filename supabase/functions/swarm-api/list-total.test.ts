// Детектор дрифта на правило «списочный ответ обязан говорить, что он обрезан» (issue #112).
//
// Почему детектор, а не обычный тест. У каждого списка есть потолок, и молчащее усечение
// НЕ ЛОМАЕТ НИЧЕГО: экран рисует приехавший кусок как полный набор, счётчики сходятся между
// собой, ошибок нет. Замер на проде 05.09.2026: в базе знаний 92 заметки видно, отдавалось 50 —
// 42 записи не существовало для человека, и никто не знал об этом полтора месяца.
//
// Правило: каждый GET-эндпоинт, отдающий список, возвращает X-Total-Count — сколько строк
// подходит под фильтры БЕЗ лимита. Заголовком, а не конвертом: ответ остаётся голым массивом,
// поэтому бот и MCP не задеты.
import { assertEquals } from "jsr:@std/assert@1";

const HERE = new URL(".", import.meta.url).pathname;

/** Списочные GET-роуты, которые обязаны отдавать счётчик. */
const LIST_ROUTES = ["/tasks", "/entries", "/meetings", "/agent-meetings"];

/** Тело обработчика роута — от его `routePath === "…"` до следующего такого же. */
function routeBody(src: string, route: string): string {
  const start = src.indexOf(`routePath === "${route}"`);
  if (start === -1) return "";
  const rest = src.slice(start + 1);
  const nextRoute = rest.search(/routePath === "\/[a-z-]+"|routePath\.match\(/);
  return nextRoute === -1 ? rest : rest.slice(0, nextRoute);
}

Deno.test("каждый списочный эндпоинт отдаёт X-Total-Count", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  const молчащие = LIST_ROUTES.filter((r) => {
    const body = routeBody(src, r);
    return body !== "" && !body.includes("X-Total-Count");
  });
  assertEquals(
    молчащие,
    [],
    `Эти списки молчат об усечении: ${молчащие.join(", ")}. ` +
      "Нужен X-Total-Count — иначе экран покажет приехавший кусок как полный набор, " +
      "и следующий потолок найдут пользователи, а не мы.",
  );
});

Deno.test("роуты из списка вообще существуют — тест не проходит вхолостую", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  for (const r of LIST_ROUTES) {
    assertEquals(routeBody(src, r) !== "", true, `роут ${r} не найден в index.ts — обнови LIST_ROUTES`);
  }
});

Deno.test("счёт берётся тем же запросом, а не вторым round-trip", async () => {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  // `count: "exact"` в select — PostgREST отдаёт число рядом с данными. Отдельный
  // `select("id")` ради счёта был бы вторым запросом на каждый список.
  assertEquals(src.includes('count: "exact"'), true);
});

Deno.test("детектор ловит молчащий список", () => {
  const молчит = `
    if (req.method === "GET" && routePath === "/entries") {
      const { data } = await q;
      return json(data, 200, origin);
    }
    if (routePath === "/tasks") {`;
  assertEquals(routeBody(молчит, "/entries").includes("X-Total-Count"), false);
});
