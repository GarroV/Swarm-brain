// Единая граница ошибок swarm-api (issue #584): подробность — в лог, клиенту — общий текст.
//
// Правило. Неожиданная ошибка (база, хранилище, внешний сервис, исключение в коде) уходит
// клиенту ОДНОЙ фразой INTERNAL_ERROR_MESSAGE со статусом 500. Текст исходной ошибки, её код
// и подсказка пишутся в лог вместе с маршрутом — по ним разбираемся мы, а не человек на экране.
// Осмысленные отказы (400/403/404/409 с нашим собственным текстом) идут мимо этого модуля через
// apiErr, как и раньше: их текст пишем мы сами, и он адресован человеку.
//
// Что в лог НЕ попадает:
//   • тело запроса — в нём личные данные и тексты встреч;
//   • заголовки — в них токен сессии;
//   • поле `details` ошибки PostgREST — для нарушения уникальности это «Key (email)=(…)»,
//     то есть значение из строки;
//   • сегменты пути с адресом почты (админка адресует участника по e-mail в пути).
//
// Модуль чистый: логгер передаётся параметром, поэтому правило проверяется юнит-тестом
// (client-error.test.ts) и порчей (scripts/core-paths.txt).

import { json, routePathOf } from "./http.ts";

/** Единственный текст, который клиент видит при неожиданной ошибке. */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong. Please try again later.";

/** Потолок длины строки лога: стек ответа внешнего сервиса может быть огромным. */
const MAX_DETAIL_LENGTH = 1000;

/** Поля объекта-ошибки (PostgREST, Storage), которые безопасно писать в лог. */
const LOGGED_FIELDS = ["code", "message", "hint"] as const;

export type ErrorLog = (line: string) => void;

const defaultLog: ErrorLog = (line) => console.error(line);

function clip(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

/** Подробность ошибки для лога. Клиенту не отдаётся никогда. */
export function errorDetail(err: unknown): string {
  if (typeof err === "string") return clip(err);
  if (err instanceof Error) return clip(`${err.name}: ${err.message}`);
  if (err && typeof err === "object") {
    const fields = err as Record<string, unknown>;
    const parts = LOGGED_FIELDS
      .filter((k) => typeof fields[k] === "string" && fields[k] !== "")
      .map((k) => `${k}=${fields[k]}`);
    if (parts.length > 0) return clip(parts.join(" "));
  }
  return clip(String(err));
}

/** Путь маршрута для лога: адреса почты в сегментах заменены заглушкой. */
export function loggedRoute(method: string, pathname: string): string {
  const path = routePathOf(pathname)
    .split("/")
    .map((seg) => (decodeSafe(seg).includes("@") ? ":email" : seg))
    .join("/");
  return `${method} ${path}`;
}

function decodeSafe(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Ответ на неожиданную ошибку: подробность — в лог с пометкой места, клиенту — общий текст.
 * `where` — короткая метка места («GET /entries», «admin: workspace create»), без данных запроса.
 */
export function serverError(
  origin: string,
  where: string,
  err: unknown,
  log: ErrorLog = defaultLog,
): Response {
  log(`[swarm-api] ${where}: ${errorDetail(err)}`);
  return json({ error: INTERNAL_ERROR_MESSAGE }, 500, origin);
}

/**
 * Граница всего обработчика: любое не пойманное исключение превращается в 500 с общим текстом,
 * а не в обрыв соединения или ответ рантайма без CORS-заголовков.
 */
export async function withErrorBoundary(
  req: Request,
  handler: (req: Request) => Promise<Response>,
  log: ErrorLog = defaultLog,
): Promise<Response> {
  try {
    return await handler(req);
  } catch (e) {
    const where = loggedRoute(req.method, new URL(req.url).pathname);
    return serverError(req.headers.get("Origin") ?? "", where, e, log);
  }
}
