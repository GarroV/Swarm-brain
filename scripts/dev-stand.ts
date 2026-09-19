// Локальный стенд доски инициатив: один адрес, на котором продукт работает целиком —
// веб, API и демо-вход. Нужен, чтобы смотреть НА ЖИВОЕ, а не на макет: посмотреть, как это
// будет, иначе можно только после раскатки, то есть слишком поздно.
//
// Что он делает и почему именно так:
//  · `/api/*` → локальные edge-функции, а по дороге cookie `roj_session` перекладывается в
//    `Authorization: Bearer` — ровно то, что в проде делает Cloudflare-функция
//    `miniapp/functions/api/[[path]].ts`. Браузер httpOnly-cookie в заголовок не положит сам.
//  · `/api/auth/demo` → выдаёт cookie демо-сессии, как `functions/api/auth/demo.ts` в проде.
//    Подпись — тем же `signJWT`, что и в продукте: своя реализация показывала бы стенд,
//    работающий не так, как прод.
//  · всё остальное → на `next dev`, чтобы правки в коде были видны сразу.
//
// Секрет здесь ЛОКАЛЬНЫЙ и другим быть не может: прод-секреты на стенде не нужны, а стенд,
// который их требует, начинают запускать с прод-секретами.
import { signJWT } from "../miniapp/functions/_lib/jwt.ts";

const PORT = Number(Deno.env.get("STAND_PORT") ?? 8080);
const WEB = Deno.env.get("STAND_WEB") ?? "http://127.0.0.1:3117";
const API = Deno.env.get("STAND_API") ?? "http://127.0.0.1:54321/functions/v1/swarm-api";
const SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "local-dev-stand-secret-not-a-real-one-32b";
const DEMO_USER_ID = 900000001; // тот же демо-пользователь, что в проде

// Заголовки ответа чистим: `fetch` ОТДАЁТ ТЕЛО УЖЕ РАСПАКОВАННЫМ, а `content-encoding: gzip`
// в ответе остаётся — браузер пробует распаковать второй раз и получает битый файл. Внешне
// это выглядит как «страница загрузилась, но пустая»: HTML пришёл, JS не выполнился ни одной
// строчкой. Поймано живым прогоном стенда.
function cleanHeaders(res: Response): Headers {
  const h = new Headers(res.headers);
  h.delete("content-encoding");
  h.delete("content-length");
  h.delete("transfer-encoding");
  return h;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Демо-вход: открыл ссылку — получил сессию. Ключ на стенде не спрашиваем: стенд слушает
  // только localhost, а лишний шаг здесь означал бы, что его будут обходить.
  if (url.pathname === "/api/auth/demo") {
    const jwt = await signJWT({ telegram_id: DEMO_USER_ID }, SECRET);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        // Без Secure: стенд ходит по http, и Secure-cookie браузер бы не сохранил.
        "Set-Cookie": `roj_session=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
      },
    });
  }

  if (url.pathname.startsWith("/api/")) {
    const headers = new Headers(req.headers);
    const cookie = headers.get("Cookie") ?? "";
    const m = cookie.match(/(?:^|;\s*)roj_session=([^;]+)/);
    if (m) headers.set("Authorization", `Bearer ${m[1]}`);
    headers.delete("Cookie");
    headers.set("Host", new URL(API).host);
    const target = `${API}${url.pathname.slice(4)}${url.search}`;
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
    return new Response(res.body, { status: res.status, headers: cleanHeaders(res) });
  }

  const res = await fetch(`${WEB}${url.pathname}${url.search}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  });
  return new Response(res.body, { status: res.status, headers: cleanHeaders(res) });
}

console.log(`стенд: http://localhost:${PORT}/api/auth/demo  (вход), веб ${WEB}, API ${API}`);
Deno.serve({ port: PORT }, handler);
