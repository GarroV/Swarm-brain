export interface OAuthConfig {
  issuer: string;
  resource: string;
  webBaseUrl: string;
}

function publicUrl(raw: string): string {
  const value = raw.replace(/\/+$/, "");
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid OAuth public URL");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("OAuth URLs require HTTPS");
  return value;
}

export function oauthConfig(): OAuthConfig {
  const webBaseUrl = publicUrl(Deno.env.get("WEB_BASE_URL") || "https://swarm-team.app");
  const apiBaseUrl = publicUrl(Deno.env.get("SWARM_PUBLIC_URL") || "https://api.swarm-team.app");
  return { issuer: webBaseUrl, webBaseUrl, resource: `${apiBaseUrl}/functions/v1/swarm-mcp` };
}

export function authorizationMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    token_endpoint: `${config.issuer}/oauth/token`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp", "offline_access"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ["mcp", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_name: "SwarmBrain MCP",
  };
}

export function oauthChallenge(config: OAuthConfig): string {
  return `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource"`;
}
