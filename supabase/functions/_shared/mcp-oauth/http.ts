import { OAuthError } from "./rules.ts";

export const PUBLIC_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "X-Content-Type-Options": "nosniff",
};

export function jsonResponse(value: unknown, status = 200, publicRoute = false): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: publicRoute ? PUBLIC_HEADERS : {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown, publicRoute = false): Response {
  if (!(error instanceof OAuthError)) console.error("MCP OAuth handler failed");
  const failure = error instanceof OAuthError
    ? error
    : new OAuthError("server_error", "Authorization service unavailable", 500);
  const response = jsonResponse(
    publicRoute
      ? { error: failure.code, error_description: failure.message }
      : { error: failure.message, code: failure.code },
    failure.status,
    publicRoute,
  );
  if (failure.status === 429) response.headers.set("Retry-After", "60");
  return response;
}
