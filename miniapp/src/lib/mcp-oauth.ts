/** OAuth-подключения хранятся отдельно от токена установленного Claude Desktop. */
export type McpOAuthConnection = {
  id: string;
  clientName: string;
  clientKind: "chatgpt" | "other";
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

export type McpConnections = {
  mcpUrl: string;
  connections: McpOAuthConnection[];
};

export type McpOAuthAuthorization = {
  requestId: string;
  clientName: string;
  redirectHost: string;
  workspaceName: string;
  expiresAt: string;
};

export const MCP_CONNECTIONS_CHANGED = "swarm:mcp-connections-changed";

/** Успешная выдача доступа ещё не означает, что ChatGPT начал обращаться к MCP. */
export function chatGptConnectionStatus(
  connections: McpOAuthConnection[],
  now: Date = new Date(),
): {
  active: boolean;
  lastSeenAt: string | null;
  expiresAt: string | null;
} {
  const active = connections.filter((c) =>
    c.clientKind === "chatgpt" && Date.parse(c.expiresAt) > now.getTime()
  );
  const seen = active.map((c) => c.lastSeenAt).filter((v): v is string =>
    v !== null && Number.isFinite(Date.parse(v))
  );
  return {
    active: active.length > 0,
    lastSeenAt: seen.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    expiresAt:
      active.map((c) => c.expiresAt).sort((a, b) =>
        Date.parse(b) - Date.parse(a)
      )[0] ?? null,
  };
}

/** Даже серверный адрес возврата не должен превращаться в выполнение javascript/data URL. */
export function safeOAuthRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}
