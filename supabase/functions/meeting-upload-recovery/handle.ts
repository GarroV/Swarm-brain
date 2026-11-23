import {
  mintUploadRecoveryToken,
  UPLOAD_RECOVERY_TTL_MS,
  type UploadRecoveryClaims,
} from "../_shared/upload-recovery-token.ts";

export interface RecoveryDeps {
  identify(req: Request): Promise<{ agentId: string; groupId: string }>;
  lookup(
    agent: { agentId: string; groupId: string },
    person: number,
    meetingId: string,
  ): Promise<Omit<UploadRecoveryClaims, "expiresAt"> | null>;
  secret: string;
  now?: () => number;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Refresh upload rights only where this same agent already held a bound meeting grant. */
export async function handleUploadRecovery(req: Request, deps: RecoveryDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let agent;
  try {
    agent = await deps.identify(req);
  } catch (e) {
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 401;
    return json({ error: "Unauthorized" }, status);
  }
  let body: { meeting_id?: unknown; person?: unknown };
  try {
    const text = await req.text();
    if (text.length > 4096) return json({ error: "body too large" }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (
    typeof body.person !== "number" || !Number.isSafeInteger(body.person) || body.person <= 0 ||
    typeof body.meeting_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.meeting_id)
  ) {
    return json({ error: "person and meeting_id required" }, 400);
  }
  try {
    const grant = await deps.lookup(agent, body.person, body.meeting_id.toLowerCase());
    if (
      !grant || grant.agentId !== agent.agentId || grant.groupId !== agent.groupId ||
      grant.telegramId !== body.person || grant.meetingId !== body.meeting_id.toLowerCase()
    ) {
      return json({ error: "no authorized prior meeting grant" }, 403);
    }
    const expiresAt = (deps.now ?? Date.now)() + UPLOAD_RECOVERY_TTL_MS;
    const token = await mintUploadRecoveryToken({ ...grant, expiresAt }, deps.secret);
    return json({ ok: true, upload_token: token, expires_at: new Date(expiresAt).toISOString() });
  } catch (e) {
    console.error("upload recovery unavailable:", e instanceof Error ? e.message : "lookup/sign failure");
    return json({ error: "upload recovery unavailable" }, 503);
  }
}
