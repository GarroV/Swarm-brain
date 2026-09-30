// Доставка в Telegram: что считается доставкой, а что — молчаливым успехом.
//
// Главный тест файла — HTTP 200 с неразобранным телом. Он сторожит дефект, который стоил бы
// дороже всего: сообщение не дошло, а сервер отчитался «доставлено», и человек не узнал ни о
// сбое записи, ни о том, что его не уведомили.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeTelegramSender } from "./telegram.ts";

const CONFIG = { botToken: "token-123", apiBase: "https://tg.test" };

function sender(reply: Response, seen: { url?: string; body?: unknown } = {}) {
  return makeTelegramSender({
    ...CONFIG,
    fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
      seen.url = String(url);
      seen.body = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(reply);
    }) as unknown as typeof fetch,
  });
}

Deno.test("ok: true — доставлено; запрос уходит с чатом, текстом и HTML-разметкой", async () => {
  const seen: { url?: string; body?: unknown } = {};
  await sender(Response.json({ ok: true, result: { message_id: 1 } }), seen)(111, "<b>Sync</b>: нет звука");
  assertEquals(seen.url, "https://tg.test/bottoken-123/sendMessage");
  assertEquals(seen.body, {
    chat_id: 111,
    text: "<b>Sync</b>: нет звука",
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
});

Deno.test("БЛОКИРУЮЩИЙ: HTTP 200 с неразобранным телом — это НЕ доставка", async () => {
  // Так отвечает шлюз-заглушка или обрезанный прокси. Проверка «ok !== false» такой ответ
  // пропускала: тело не разобралось, поля ok нет, значит «не false» — и молчание засчиталось
  // как доставленное сообщение.
  const broken = new Response("<html>502 Bad Gateway</html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
  const error = await assertRejects(() => sender(broken)(111, "текст"), Error);
  assert(
    /не разобран/.test(error.message),
    `причина должна называть неразобранный ответ, а не молчать: ${error.message}`,
  );
});

Deno.test("ok: false при HTTP 200 — не доставка, причина из description", async () => {
  const error = await assertRejects(
    () => sender(Response.json({ ok: false, description: "chat not found" }))(111, "текст"),
    Error,
  );
  assert(error.message.includes("chat not found"), error.message);
});

Deno.test("HTTP 403 (бот заблокирован) — не доставка, в причине код и описание", async () => {
  const blocked = Response.json({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status: 403 });
  const error = await assertRejects(() => sender(blocked)(111, "текст"), Error);
  assert(error.message.includes("403"), error.message);
  assert(error.message.includes("blocked"), error.message);
});

Deno.test("тело без описания всё равно объясняет отказ, а не оставляет пустоту", async () => {
  const error = await assertRejects(() => sender(Response.json({ ok: 1 }, { status: 200 }))(111, "текст"), Error);
  assert(error.message.includes("no description"), error.message);
});

Deno.test("токена на сервере нет — бросаем, а не выходим тихо", async () => {
  const send = makeTelegramSender({ botToken: "", apiBase: "https://tg.test" });
  const error = await assertRejects(() => send(111, "текст"), Error);
  assert(error.message.includes("TELEGRAM_BOT_TOKEN"), error.message);
});

Deno.test("сеть не отвечает — ошибка доходит до вызывающего", async () => {
  const send = makeTelegramSender({
    ...CONFIG,
    fetchImpl: (() => Promise.reject(new Error("connection refused"))) as unknown as typeof fetch,
  });
  const error = await assertRejects(() => send(111, "текст"), Error);
  assert(error.message.includes("connection refused"), error.message);
});
