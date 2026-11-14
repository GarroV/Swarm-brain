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
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

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

/** Comments cannot stand in for actual header/count code. Keep quoted values intact. */
function withoutComments(src: string): string {
  return src.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token,
  );
}

/** The delegated module's actual function body, excluding other functions/comments. */
function delegatedBody(src: string): string {
  const code = withoutComments(src);
  const start = code.indexOf("export async function handleMeetingsList(");
  if (start < 0) return "";
  const open = code.indexOf("{", start);
  let depth = 0, quote = "", escaped = false;
  for (let i = open; i >= 0 && i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

function resolvedBody(index: string, route: string, meetings: string): string {
  const inline = routeBody(index, route);
  if (route === "/meetings" && /\bhandleMeetingsList\s*\(/.test(withoutComments(inline))) {
    if (
      !/import\s*\{[^}]*\bhandleMeetingsList\b[^}]*\}\s*from\s*["']\.\/meetings-routes\.ts["']/.test(
        withoutComments(index),
      )
    ) return "";
    return delegatedBody(meetings);
  }
  return withoutComments(inline);
}

const hasTotalHeader = (body: string) =>
  /["']X-Total-Count["']\s*(?:\]\s*=|:)|\.set\(\s*["']X-Total-Count["']\s*,/.test(withoutComments(body));

async function sources() {
  return {
    index: await Deno.readTextFile(`${HERE}index.ts`),
    meetings: await Deno.readTextFile(`${HERE}meetings-routes.ts`),
  };
}

Deno.test("каждый списочный эндпоинт отдаёт X-Total-Count", async () => {
  const { index: src, meetings } = await sources();
  const молчащие = LIST_ROUTES.filter((r) => {
    const body = resolvedBody(src, r, meetings);
    return body !== "" && !hasTotalHeader(body);
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
  const { index: src, meetings } = await sources();
  for (const r of LIST_ROUTES) {
    assertEquals(
      resolvedBody(src, r, meetings) !== "",
      true,
      `роут ${r} не найден в index.ts — обнови LIST_ROUTES`,
    );
  }
});

Deno.test("счёт берётся тем же запросом, а не вторым round-trip", async () => {
  const { index: src, meetings } = await sources();
  // `count: "exact"` в select — PostgREST отдаёт число рядом с данными. Отдельный
  // `select("id")` ради счёта был бы вторым запросом на каждый список.
  assertEquals(src.includes('count: "exact"'), true);
  assertEquals(resolvedBody(src, "/meetings", meetings).includes('count: "exact"'), true);
});

Deno.test("детектор ловит молчащий список", () => {
  const молчит = `
    if (req.method === "GET" && routePath === "/entries") {
      const { data } = await q;
      return json(data, 200, origin);
    }
    if (routePath === "/tasks") {`;
  assertEquals(hasTotalHeader(routeBody(молчит, "/entries")), false);
});

Deno.test("делегированный meetings: удаление настоящего заголовка краснит детектор, комментарий его не подменяет", async () => {
  const { index, meetings } = await sources();
  assertEquals(hasTotalHeader(resolvedBody(index, "/meetings", meetings)), true);
  const anchor = 'headers["X-Total-Count"]';
  assertEquals(meetings.split(anchor).length - 1, 1, "мутация обязана менять настоящий заголовок");
  const broken = meetings.replace(anchor, 'headers["X-Removed-Total"] /* headers["X-Total-Count"] = "fake"; */');
  assertEquals(hasTotalHeader(resolvedBody(index, "/meetings", broken)), false);
  assertEquals(resolvedBody(index, "/meetings", ""), "", "потерянный делегат не должен проходить вхолостую");
});
