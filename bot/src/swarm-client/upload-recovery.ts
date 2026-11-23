import { SwarmClient } from "./client.ts";
import { SwarmHttpError } from "./errors.ts";

/**
Fresh upload-only permits, one per meeting; service credentials never go to ingest.
*/
export function recoveryQueueClient(config: {
  baseUrl: string;
  serviceToken: string;
  person: number;
  fetch?: typeof globalThis.fetch;
}): Pick<SwarmClient, "ingest" | "statuses"> {
  const clients = new Map<string, Promise<SwarmClient>>();
  const doFetch = config.fetch ?? globalThis.fetch;
  const baseUrl = config.baseUrl.replace(/\/$/u, "");
  const clientFor = (meetingId: string): Promise<SwarmClient> => {
    let client = clients.get(meetingId);
    if (client !== undefined) return client;
    client = (async () => {
      const response = await doFetch(`${baseUrl}/meeting-upload-recovery`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.serviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ person: config.person, meeting_id: meetingId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new SwarmHttpError(response.status, "upload recovery refused");
      const body = (await response.json()) as { upload_token?: unknown };
      if (typeof body.upload_token !== "string" || !body.upload_token.startsWith("sru_"))
        throw new Error("invalid upload recovery response");
      return new SwarmClient({
        baseUrl,
        token: body.upload_token,
        onBehalfOf: config.person,
        fetch: doFetch,
        retry: { attempts: 1 },
      });
    })();
    clients.set(meetingId, client);
    return client;
  };
  return {
    ingest: async (input) => {
      const client = await clientFor(input.meetingId);
      return client.ingest(input);
    },
    statuses: async (ids) => {
      const result = new Map();
      for (const id of ids) {
        const client = await clientFor(id);
        const statuses = await client.statuses([id]);
        for (const [key, value] of statuses) result.set(key, value);
      }
      return result;
    },
  };
}
