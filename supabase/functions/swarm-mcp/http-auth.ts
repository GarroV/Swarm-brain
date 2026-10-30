/** OAuth discovery uses HTTP challenges. Static Claude bridge tokens keep their existing RPC errors. */
export function oauthChallenge(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}"`;
}

export function oauthUnauthorized(id: unknown, metadataUrl: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32001, message: "OAuth authorization required — connect your Swarm account" },
  }, {
    status: 401,
    headers: {
      "WWW-Authenticate": oauthChallenge(metadataUrl),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    },
  });
}
