import { mcpApiFetch } from "./api";
export type DesktopMcpStatus = { active: boolean; expiresAt: string | null; lastSeenAt: string | null };
export const fetchChatGptDesktop = () => mcpApiFetch<DesktopMcpStatus>("/mcp/desktop/setup", { cache: "no-store" });
export const mintChatGptDesktop = () => mcpApiFetch<{ oneLiner: string }>("/mcp/desktop/token", { method: "POST" });
export const revokeChatGptDesktop = () => mcpApiFetch<{ ok: true }>("/mcp/desktop/token", { method: "DELETE" });
