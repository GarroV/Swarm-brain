import { assertEquals } from "jsr:@std/assert@1";
import { queryToState, stateToPath, stateToQuery } from "./royUrl.ts";

Deno.test("корень дашборда не мусорит в адресе", () => {
  assertEquals(stateToQuery("search", null), "");
  assertEquals(stateToPath("search", null), "/");
});

Deno.test("таб попадает в адрес, дефолтный — нет", () => {
  assertEquals(stateToQuery("task", null), "tab=task");
  assertEquals(queryToState("?tab=task").tab, "task");
});

Deno.test("задача: адрес туда и обратно", () => {
  const route = { view: "taskDetail", params: { id: "t-1" } } as const;
  const qs = stateToQuery("task", route);
  assertEquals(qs, "tab=task&view=taskDetail&id=t-1");
  assertEquals(queryToState(qs), { tab: "task", route });
});

Deno.test("проект и запись: адрес туда и обратно", () => {
  for (const view of ["project", "record", "meetingDetail"] as const) {
    const route = { view, params: { id: "x-9" } };
    assertEquals(queryToState(stateToQuery("book", route)), { tab: "book", route });
  }
});

Deno.test("вычитка встречи сериализуется в наследуемый ?meeting= — старые ссылки не разошлись", () => {
  const route = { view: "meetingReview", params: { id: "m-7" } } as const;
  assertEquals(stateToQuery("cal", route), "meeting=m-7");
  // Ровно тот адрес, который рассылают уведомления и лаунч PWA.
  assertEquals(queryToState("?meeting=m-7"), { tab: "cal", route });
});

Deno.test("ответ на вопрос переживает адрес вместе с текстом запроса", () => {
  const route = { view: "answer", params: { query: "что по Сербии?" } } as const;
  // tab здесь null, а не "search": дефолтный таб в адрес не пишется, поэтому на обратном
  // пути его «в адресе не задано». Потребитель подставляет свой дефолт сам — так ссылка
  // остаётся короткой, а поведение по умолчанию не зашито в формат.
  assertEquals(queryToState(stateToQuery("search", route)), { tab: null, route });
});

Deno.test("дефолтный таб опускается: null означает «в адресе не задано»", () => {
  assertEquals(stateToQuery("search", null), "");
  assertEquals(queryToState("").tab, null);
  assertEquals(queryToState("?tab=search").tab, "search");   // явно указанный — читается
});

Deno.test("экраны без параметров открываются по одному имени", () => {
  for (const view of ["settings", "team", "admin", "map", "base", "ask", "more", "newEntry"] as const) {
    assertEquals(queryToState(`?view=${view}`).route, { view });
  }
});

Deno.test("meetAdmin помнит режим, но не выдумывает несуществующий", () => {
  assertEquals(queryToState("?view=meetAdmin&mode=review").route, { view: "meetAdmin", params: { mode: "review" } });
  assertEquals(queryToState("?view=meetAdmin&mode=чушь").route, { view: "meetAdmin" });
});

Deno.test("роут без обязательного id игнорируется, а не открывает белый экран", () => {
  for (const view of ["taskDetail", "project", "record", "meetingDetail", "meetingReview"] as const) {
    assertEquals(queryToState(`?view=${view}`).route, null, view);
  }
  assertEquals(queryToState("?view=answer").route, null);
});

Deno.test("чужая опечатка в адресе не роняет приложение", () => {
  assertEquals(queryToState("?tab=несуществующий").tab, null);
  assertEquals(queryToState("?view=несуществующий").route, null);
  assertEquals(queryToState(""), { tab: null, route: null });
  assertEquals(queryToState("?"), { tab: null, route: null });
  assertEquals(queryToState("мусор без знака равно"), { tab: null, route: null });
});

Deno.test("id с непечатным содержимым переживает кодирование", () => {
  const route = { view: "taskDetail", params: { id: "a b&c=d" } } as const;
  assertEquals(queryToState(stateToQuery("task", route)), { tab: "task", route });
});
