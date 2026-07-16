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

export function json(data: unknown, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export function apiErr(status: number, message: string, origin = ""): Response {
  return json({ error: message }, status, origin);
}
