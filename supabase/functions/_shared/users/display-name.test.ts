import { assertEquals } from "jsr:@std/assert@1";
import { personLabel, personName, resolvePersonNames } from "./display-name.ts";

Deno.test("имя и фамилия — в приоритете над @username и e-mail", () => {
  assertEquals(
    personName({ first_name: "Анна", last_name: "Ли", username: "anna", email: "a@x.io" }),
    "Анна Ли",
  );
});

Deno.test("только имя без фамилии — без лишнего пробела", () => {
  assertEquals(personName({ first_name: " Анна ", last_name: null }), "Анна");
});

Deno.test("нет имени — @username", () => {
  assertEquals(personName({ username: "anna", email: "a@x.io" }), "@anna");
  assertEquals(personName({ username: "@anna" }), "@anna");
});

Deno.test("префикс username настраивается (старые ответы /users, /me — без «@»)", () => {
  assertEquals(personName({ username: "anna" }, { usernamePrefix: "" }), "anna");
});

Deno.test("вход через Google: нет имени и username — e-mail, а не номер", () => {
  assertEquals(personName({ first_name: "", username: null, email: "g@dodobrands.io" }), "g@dodobrands.io");
  assertEquals(personLabel({ email: "g@dodobrands.io" }, -30), "g@dodobrands.io");
});

Deno.test("назвать нечем — null, а personLabel даёт «#id» (и для отрицательного id)", () => {
  assertEquals(personName({ first_name: "  ", username: "", email: " " }), null);
  assertEquals(personName(null), null);
  assertEquals(personLabel(undefined, -30), "#-30");
  assertEquals(personLabel({}, 744230399), "#744230399");
});

type Res = { data: unknown[] | null; error: { message: string } | null };
// Подмена клиента: на каждую таблицу — готовый ответ; запоминаем, какие id спросили. Колонки
// режутся по select, как в PostgREST: забытая в select колонка (e-mail) в ответ не попадёт.
function fakeClient(answers: Record<string, Res>) {
  const asked: Record<string, unknown[]> = {};
  const from = (table: string) => ({
    select: (cols: string) => ({
      in: (_c: string, ids: unknown[]) => {
        asked[table] = ids;
        const keep = cols.split(",").map((c) => c.trim());
        const res = answers[table];
        const data =
          res.data?.map((row) =>
            Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([k]) => keep.includes(k)))
          ) ?? null;
        return Promise.resolve({ data, error: res.error });
      },
    }),
  });
  return { client: { from } as unknown as Parameters<typeof resolvePersonNames>[0], asked };
}

Deno.test("resolvePersonNames: имя из профиля, @username и e-mail из allowed_users", async () => {
  const { client, asked } = fakeClient({
    user_profiles: { data: [{ telegram_id: 1, first_name: "Анна", last_name: null }], error: null },
    allowed_users: {
      data: [
        { telegram_id: 1, username: "anna", email: "a@x.io" },
        { telegram_id: 2, username: "bob", email: null },
        { telegram_id: -30, username: null, email: "g@dodobrands.io" },
      ],
      error: null,
    },
  });
  const names = await resolvePersonNames(client, [1, 2, -30, 99, null, 1]);
  assertEquals(Object.fromEntries(names), { 1: "Анна", 2: "@bob", [-30]: "g@dodobrands.io" });
  // null и дубли в .in(...) не уходят: один null ронял запрос имён для всех.
  assertEquals(asked.user_profiles, [1, 2, -30, 99]);
});

Deno.test("resolvePersonNames: упал один запрос — имена из второго всё равно есть", async () => {
  const { client } = fakeClient({
    user_profiles: { data: null, error: { message: "boom" } },
    allowed_users: { data: [{ telegram_id: -30, username: null, email: "g@dodobrands.io" }], error: null },
  });
  const realError = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const names = await resolvePersonNames(client, [-30]);
    assertEquals(names.get(-30), "g@dodobrands.io");
  } finally {
    console.error = realError;
  }
  assertEquals(logged.length, 1);
});

Deno.test("resolvePersonNames: пустой список — без запросов", async () => {
  const { client, asked } = fakeClient({});
  assertEquals((await resolvePersonNames(client, [])).size, 0);
  assertEquals(asked, {});
});
