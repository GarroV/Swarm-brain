// Shared OAuth rules: registration, authorize and exchange must agree on the same values.
export const ACCESS_PREFIX = "smoa_";
export const REFRESH_PREFIX = "smor_";
export const CODE_PREFIX = "smoc_";
export const MAX_BODY_BYTES = 16_384;
export const ACCESS_SECONDS = 3600;
export const GRANT_SECONDS = 30 * 24 * 3600;

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

const isControl = (char: string): boolean => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127;

export function validRedirectUri(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length > 2048 || value.includes("#") || /\s/.test(value) ||
    [...value].some(isControl)
  ) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function normalizeScope(value: unknown): string {
  if (value === undefined || value === null) return "mcp offline_access";
  if (typeof value !== "string" || value.length > 100) throw new OAuthError("invalid_scope", "Unsupported scope");
  const scopes = new Set(value.split(/\s+/).filter(Boolean));
  if (!scopes.has("mcp") || [...scopes].some((scope) => scope !== "mcp" && scope !== "offline_access")) {
    throw new OAuthError("invalid_scope", "Only mcp and offline_access are supported");
  }
  return scopes.has("offline_access") ? "mcp offline_access" : "mcp";
}

export function validateRegistration(input: unknown): { clientName: string; redirectUris: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OAuthError("invalid_client_metadata", "Expected an object");
  }
  const value = input as Record<string, unknown>;
  const redirects = value.redirect_uris;
  if (
    !Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 || !redirects.every(validRedirectUri)
  ) {
    throw new OAuthError("invalid_redirect_uri", "Register between one and ten HTTPS or loopback callback URLs");
  }
  if (value.token_endpoint_auth_method !== undefined && value.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Only public clients using PKCE are supported");
  }
  if (
    value.response_types !== undefined &&
    (!Array.isArray(value.response_types) || value.response_types.length !== 1 || value.response_types[0] !== "code")
  ) {
    throw new OAuthError("invalid_client_metadata", "Only authorization code is supported");
  }
  if (
    value.grant_types !== undefined &&
    (!Array.isArray(value.grant_types) || !value.grant_types.includes("authorization_code") ||
      value.grant_types.some((grant) => grant !== "authorization_code" && grant !== "refresh_token"))
  ) {
    throw new OAuthError("invalid_client_metadata", "Unsupported grant type");
  }
  if (value.client_name !== undefined && (typeof value.client_name !== "string" || value.client_name.length > 200)) {
    throw new OAuthError("invalid_client_metadata", "Client name is too long");
  }
  const clientName =
    [...(typeof value.client_name === "string" ? value.client_name : "MCP client")].filter((char) => !isControl(char))
      .join("").trim() ||
    "MCP client";
  return { clientName, redirectUris: [...new Set(redirects as string[])] };
}

export function clientKind(redirects: string[]): "chatgpt" | "other" {
  return redirects.some((uri) => {
      try {
        return ["chatgpt.com", "chat.openai.com"].includes(new URL(uri).hostname);
      } catch {
        return false;
      }
    })
    ? "chatgpt"
    : "other";
}

export const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export const randomSecret = (prefix = ""): string => prefix + base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "Invalid PKCE verifier");
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function requireParam(params: URLSearchParams, key: string, max = 2048): string {
  const values = params.getAll(key);
  if (values.length !== 1 || !values[0] || values[0].length > max) {
    throw new OAuthError("invalid_request", `Expected one ${key}`);
  }
  return values[0];
}

export async function boundedBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) throw new OAuthError("invalid_request", "Request body too large", 413);
  if (!req.body) return "";
  const reader = req.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new OAuthError("invalid_request", "Request body too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new OAuthError("invalid_request", "Expected application/json", 415);
  }
  try {
    const value = JSON.parse(await boundedBody(req));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError("invalid_request", "Invalid JSON body");
  }
}
