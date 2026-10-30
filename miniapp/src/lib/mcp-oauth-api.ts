import { mcpApiFetch } from "./api";
import type { McpConnections, McpOAuthAuthorization } from "./mcp-oauth";

export function fetchMcpConnections(): Promise<McpConnections> {
  return mcpApiFetch("/mcp/connections");
}

export function revokeMcpConnection(id: string): Promise<{ ok: true }> {
  return mcpApiFetch(`/mcp/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchMcpAuthorization(
  requestId: string,
): Promise<McpOAuthAuthorization> {
  return mcpApiFetch(
    `/mcp/oauth/authorize?request=${encodeURIComponent(requestId)}`,
  );
}

export function decideMcpAuthorization(
  requestId: string,
  accept: boolean,
): Promise<{ redirectUrl: string }> {
  return mcpApiFetch("/mcp/oauth/authorize", {
    method: "POST",
    body: JSON.stringify({ requestId, accept }),
  });
}
