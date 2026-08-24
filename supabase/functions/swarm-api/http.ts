// HTTP-хелперы swarm-api: CORS + JSON-ответы. Общий модуль, чтобы index.ts и
// доменные роут-модули (task-labels.ts и др.) отдавали идентичные заголовки без дублей.

const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "*";

export function corsHeaders(origin: string): Record<string, string> {
  const allowOrigin =
    MINIAPP_ORIGIN === "*" ? "*"
    : origin === MINIAPP_ORIGIN ? origin
    : MINIAPP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Cache-Control: no-store на КАЖДОМ ответе — это приватный API (чужие записи, задачи,
// тезисы). Без него ответ вправе осесть в промежуточном кэше и отдаться повторно/не тому
// (см. issue #71: service worker кэшировал /api/* и показывал данные «на шаг назад»).
export function json(data: unknown, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

export function apiErr(status: number, message: string, origin = ""): Response {
  return json({ error: message }, status, origin);
}
