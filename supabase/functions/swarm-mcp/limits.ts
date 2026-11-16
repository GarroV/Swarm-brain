// Лимиты MCP-входа: размер тела и частота вызовов.
//
// Размер — ДО разбора JSON: тело читается потоком и обрывается на MAX_BODY_BYTES, потому что
// Content-Length можно не прислать или прислать неправдой. Частота — счётчиками в базе
// (`mcp_oauth_take_rate`, миграция 20261030150000, тот же механизм, что у OAuth-эндпоинтов):
// edge-runtime держит несколько воркеров, память процесса между ними не общая.
// Сбой самого счётчика запрос не роняет (fail-open + console.error): без базы всё равно не
// работает ни один инструмент, а хендшейк коннектора ронять нельзя.

import { sha256 } from "../_shared/mcp-oauth/rules.ts";

export const MAX_BODY_BYTES = 1024 * 1024;
export const RATE_WINDOW_SECONDS = 60;
export const TOKEN_CALLS_PER_WINDOW = 120;
export const ADDRESS_CALLS_PER_WINDOW = 600;
/** JSON-RPC код превышения лимита (в зоне серверных ошибок -32000…-32099). */
export const RATE_LIMIT_ERROR_CODE = -32029;
export const BODY_TOO_LARGE_CODE = -32600;
export const BODY_TOO_LARGE_MESSAGE = "Request body too large (limit 1 MB)";
export const RATE_LIMIT_MESSAGE = "Too many requests — slow down and retry in a minute";

export type BodyRead = { kind: "ok"; text: string } | { kind: "too_large" };

/** Читает тело не больше maxBytes. Больше — `too_large`, остаток потока отбрасывается. */
export async function readBodyLimited(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: "too_large" };
  if (!req.body) return { kind: "ok", text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", text: new TextDecoder().decode(all) };
}

/**
 * Адрес клиента для счётчика: ПЕРВЫЙ элемент x-forwarded-for. На проде цепочка Cloudflare → фронт
 * (deploy/front/src/index.js ставит X-Swarm-Client-IP из CF-Connecting-IP) → edge Caddy (пускает
 * только запросы фронта и целиком перезаписывает x-forwarded-for этим значением) → envoy (не трогает). Клиент подделать первый хоп не
 * может, а «последний» стал бы общим для всех, если бы какой-то слой дописал свой хоп.
 * cf-connecting-ip на этом пути не доверенный и не используется. Нет заголовка — корзина "unknown".
 */
export function clientAddress(headers: Headers): string {
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return (first || "unknown").slice(0, 64);
}

export interface RateSink {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

async function take(sink: RateSink, bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await sink.rpc("mcp_oauth_take_rate", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error) {
    console.error("MCP rate limit counter failed:", error.code);
    return true;
  }
  return data !== false;
}

/** true — запрос в пределах лимита. Ключ — хэш, сырой адрес и токен в базу не попадают. */
export async function takeAddressRate(sink: RateSink, headers: Headers): Promise<boolean> {
  const hash = (await sha256(clientAddress(headers))).slice(0, 32);
  return take(sink, `mcp:addr:${hash}`, ADDRESS_CALLS_PER_WINDOW);
}

/** `tokenHash` — sha256 токена (уже посчитан в index.ts). */
export function takeTokenRate(sink: RateSink, tokenHash: string): Promise<boolean> {
  return take(sink, `mcp:tok:${tokenHash.slice(0, 32)}`, TOKEN_CALLS_PER_WINDOW);
}

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

export function bodyTooLargeResponse(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: BODY_TOO_LARGE_CODE, message: BODY_TOO_LARGE_MESSAGE } }),
    { status: 413, headers: CORS },
  );
}

export function rateLimitedResponse(id: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: RATE_LIMIT_ERROR_CODE, message: RATE_LIMIT_MESSAGE } }),
    { status: 429, headers: { ...CORS, "Retry-After": String(RATE_WINDOW_SECONDS) } },
  );
}

/**
 * Входные лимиты ДО любой проверки токена (до поиска в базе): частота с адреса — для всех запросов,
 * затем размер тела. Response — отказ (429/413); строка — тело запроса.
 */
export async function admitRequest(sink: RateSink, req: Request): Promise<Response | string> {
  if (!(await takeAddressRate(sink, req.headers))) return rateLimitedResponse(null);
  const raw = await readBodyLimited(req);
  return raw.kind === "too_large" ? bodyTooLargeResponse() : raw.text;
}
