// Смоук эндпоинта целиком: работает НАСТОЯЩИЙ index.ts, подменены только сеть (fetch) и
// Deno.serve. Юнит-тест на conferenceInfo доказывает разбор ссылки, но не доказывает, что
// разобранное доехало до ответа — а читают рекордер и бот именно ответ.
//
// deno-lint-ignore no-import-prefix -- канон серверных тестов Swarm: std тянется по https, карты импортов у supabase/functions нет
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const TOKEN = "smcp_stub-token";
const hashBuffer = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(TOKEN),
);
const TOKEN_HASH = Array.from(new Uint8Array(hashBuffer))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

// Что отвечает подменённая сеть — настраивается на каждый сценарий.
let googleConnected = true;
let tokenExchangeOk = true;
let calendarItems: unknown[] | null = [];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

// Стенда с базой и Google здесь нет и быть не должно: смоук проверяет СВОЙ код, а не чужие
// сервисы. Всё, что уходит наружу, перехватывается по адресу. Подмена живёт ровно на время
// вызова обработчика (см. call): весь серверный набор гоняется одним процессом, и оставленный
// глобальный fetch стал бы ловушкой для соседнего теста, который сеть трогает по-настоящему.
const realFetch = globalThis.fetch;
const stubFetch = ((input: Request | URL | string) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input.url;
  if (url.includes("/rest/v1/allowed_users")) {
    return json({
      telegram_id: 42,
      group_id: "cee",
      claude_mcp_token_hash: TOKEN_HASH,
      claude_mcp_token_expires_at: null,
      recorder_token_hash: null,
      recorder_token_expires_at: null,
      recorder_token_prev_hash: null,
      recorder_token_prev_expires_at: null,
    });
  }
  if (url.includes("/rest/v1/user_integrations")) {
    return googleConnected ? json({ api_key: "refresh-token" }) : json(null);
  }
  if (url.includes("oauth2.googleapis.com/token")) {
    return tokenExchangeOk
      ? json({ access_token: "access-token" })
      : json({ error: "invalid_grant" }, 400);
  }
  if (url.includes("googleapis.com/calendar/v3")) {
    return calendarItems === null
      ? json({ error: "boom" }, 500)
      : json({ items: calendarItems });
  }
  throw new Error(`смоук не ждал запроса наружу: ${url}`);
}) as typeof fetch;

// Клиент собирается на импорте модуля — переменные нужны ровно до него и сразу убираются,
// чтобы соседние тесты не увидели подставного окружения.
Deno.env.set("SUPABASE_URL", "https://stub.supabase.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");

// Deno.serve подменён ДО импорта: иначе смоук поднял бы настоящий порт.
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
// deno-lint-ignore no-explicit-any
const denoAny = Deno as any;
const realServe = denoAny.serve;
denoAny.serve = (h: Handler) => {
  handler = h;
  return {
    finished: Promise.resolve(),
    shutdown: () => Promise.resolve(),
    ref: () => {},
    unref: () => {},
  };
};
await import("./index.ts");
denoAny.serve = realServe;
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

function meetingNow(extra: Record<string, unknown>) {
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 30 * 60_000).toISOString();
  return {
    id: "e1",
    summary: "Планёрка",
    start: { dateTime: start },
    end: { dateTime: end },
    ...extra,
  };
}

/** Ровно то, что эндпоинт отдаёт наружу: причина про встречу — сверху, про ссылку — внутри meeting. */
interface Answer {
  meeting?: {
    join_url: string | null;
    platform: string | null;
    reason?: string;
  } | null;
  reason?: string;
  error?: string;
}

async function call(
  token: string | null = TOKEN,
): Promise<{ status: number; body: Answer }> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  globalThis.fetch = stubFetch;
  try {
    const res = await handler!(
      new Request("https://stub.invalid/meeting-current", { headers }),
    );
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("встреча со ссылкой — в ответе ссылка и площадка, причины отказа нет", async () => {
  googleConnected = true;
  tokenExchangeOk = true;
  calendarItems = [
    meetingNow({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
  ];

  const { status, body } = await call();

  assertEquals(status, 200);
  assertEquals(body.meeting?.join_url, "https://meet.google.com/abc-defg-hij");
  assertEquals(body.meeting?.platform, "meet");
  assertEquals(body.meeting?.reason, undefined);
});

Deno.test("ссылку положили в описание — эндпоинт её находит", async () => {
  calendarItems = [
    meetingNow({
      description: "Повестка на квартал\nЗвонок: https://ktalk.ru/weekly-42",
    }),
  ];

  const { body } = await call();

  assertEquals(body.meeting?.join_url, "https://ktalk.ru/weekly-42");
  assertEquals(body.meeting?.platform, "kontur");
});

Deno.test("встреча без ссылки — в ответе явная причина, а не молчаливый null", async () => {
  calendarItems = [meetingNow({ location: "Переговорка 3, второй этаж" })];

  const { body } = await call();

  assertEquals(body.meeting?.join_url, null);
  assertEquals(body.meeting?.platform, null);
  assertEquals(body.meeting?.reason, "no_conference_link");
});

Deno.test("встречи нет — причина про встречу, а не про ссылку", async () => {
  calendarItems = [];

  const { body } = await call();

  assertEquals(body.meeting, null);
  assertEquals(body.reason, "no_ongoing_event");
});

Deno.test("календарь не ответил — это ошибка календаря, а не «ссылки нет»", async () => {
  calendarItems = null;

  const { body } = await call();

  assertEquals(body.meeting, null);
  assertEquals(body.reason, "calendar_api_error");
});

Deno.test("календарь не подключён — сказано прямо", async () => {
  googleConnected = false;
  calendarItems = [];

  const { body } = await call();

  assertEquals(body.reason, "google_not_connected");
  googleConnected = true;
});

Deno.test("refresh-токен мёртв — просим переподключить календарь", async () => {
  tokenExchangeOk = false;

  const { body } = await call();

  assertEquals(body.reason, "token_refresh_failed");
  tokenExchangeOk = true;
});

Deno.test("без токена — 401, и ни слова про встречу", async () => {
  const { status, body } = await call(null);

  assertEquals(status, 401);
  assertEquals(body.meeting, undefined);
});
