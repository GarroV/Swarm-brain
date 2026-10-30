import { proxyMcpOAuth } from "../_lib/mcp-oauth-proxy";

export const onRequest = (
  ctx: { request: Request; env: { SWARM_API_URL?: string } },
) => proxyMcpOAuth(ctx.request, ctx.env);
