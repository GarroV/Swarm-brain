import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { errorDetail, INTERNAL_ERROR_MESSAGE, loggedRoute, serverError, withErrorBoundary } from "./client-error.ts";

const PG_ERROR = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "allowed_users_email_key"',
  details: "Key (email)=(someone@example.com) already exists.",
  hint: "",
};

function collect(): { lines: string[]; log: (l: string) => void } {
  const lines: string[] = [];
  return { lines, log: (l) => lines.push(l) };
}

Deno.test("serverError: клиенту только общий текст, подробность — в лог с меткой места", async () => {
  const { lines, log } = collect();
  const res = serverError("", "GET /entries", PG_ERROR, log);
  assertEquals(res.status, 500);
  const body = await res.text();
  assertEquals(JSON.parse(body), { error: INTERNAL_ERROR_MESSAGE });
  assert(!body.includes("allowed_users"), "имя таблицы/ограничения не должно уходить клиенту");
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], "GET /entries");
  assertStringIncludes(lines[0], "allowed_users_email_key");
  assertStringIncludes(lines[0], "code=23505");
});

Deno.test("errorDetail: поле details PostgREST в лог не пишется — в нём значения строки", () => {
  const line = errorDetail(PG_ERROR);
  assert(!line.includes("someone@example.com"), line);
  assert(!line.includes("hint="), "пустые поля не печатаются");
});

Deno.test("errorDetail: Error, строка, прочее", () => {
  assertEquals(errorDetail(new TypeError("boom")), "TypeError: boom");
  assertEquals(errorDetail("storage down"), "storage down");
  assertEquals(errorDetail(42), "42");
  assertEquals(errorDetail(null), "null");
  assertEquals(errorDetail({ foo: 1 }), "[object Object]");
});

Deno.test("errorDetail: длинная подробность обрезается", () => {
  const line = errorDetail("x".repeat(5000));
  assertEquals(line.length, 1001);
  assert(line.endsWith("…"));
});

Deno.test("loggedRoute: снимает префикс функции и прячет адрес почты в пути", () => {
  assertEquals(loggedRoute("GET", "/functions/v1/swarm-api/tasks/42"), "GET /tasks/42");
  assertEquals(
    loggedRoute("PATCH", "/swarm-api/admin/users/someone%40example.com"),
    "PATCH /admin/users/:email",
  );
  assertEquals(loggedRoute("GET", "/swarm-api/bad/%E0%A4%A"), "GET /bad/%E0%A4%A");
});

Deno.test("withErrorBoundary: брошенное исключение — 500 с общим текстом и CORS, маршрут в логе", async () => {
  const { lines, log } = collect();
  const req = new Request("https://x.test/functions/v1/swarm-api/tasks/7?token=secret", {
    method: "PATCH",
    headers: { Origin: "https://app.test", Authorization: "Bearer secret-token" },
  });
  const res = await withErrorBoundary(req, () => {
    throw new Error('relation "tasks" does not exist');
  }, log);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: INTERNAL_ERROR_MESSAGE });
  assert(res.headers.get("Access-Control-Allow-Origin"), "у ответа границы есть CORS");
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], "PATCH /tasks/7");
  assertStringIncludes(lines[0], 'relation "tasks" does not exist');
  assert(!lines[0].includes("secret"), "ни токена, ни строки запроса в логе");
});

Deno.test("withErrorBoundary: обычный ответ проходит как есть, лог пуст", async () => {
  const { lines, log } = collect();
  const req = new Request("https://x.test/swarm-api/me");
  const res = await withErrorBoundary(req, () => Promise.resolve(new Response("ok", { status: 403 })), log);
  assertEquals(res.status, 403);
  assertEquals(await res.text(), "ok");
  assertEquals(lines.length, 0);
});
