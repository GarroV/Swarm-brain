// A short-lived permit to upload/status one existing grant. It cannot claim or heartbeat.
const PREFIX = "sru_";
const DOMAIN = "swarm-upload-recovery-v1:";
export const UPLOAD_RECOVERY_TTL_MS = 15 * 60_000;

export interface UploadRecoveryClaims {
  grantId: string;
  agentId: string;
  groupId: string;
  telegramId: number;
  meetingId: string;
  expiresAt: number;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("upload recovery signing key unavailable");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function mintUploadRecoveryToken(claims: UploadRecoveryClaims, secret: string): Promise<string> {
  const payload = encode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(DOMAIN + payload));
  return `${PREFIX}${payload}.${encode(new Uint8Array(signature))}`;
}

export function isUploadRecoveryToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

export async function verifyUploadRecoveryToken(
  token: string,
  req: Request,
  secret: string,
  now = Date.now(),
): Promise<UploadRecoveryClaims> {
  const route = new URL(req.url).pathname.split("/").at(-1);
  if (
    !((route === "meeting-ingest" && req.method === "POST") || (route === "meeting-status" && req.method === "GET"))
  ) {
    throw new Error("upload recovery permit only covers upload and status");
  }
  if (token.length > 4096) throw new Error("invalid upload recovery permit");
  try {
    const [payload, signature, extra] = token.slice(PREFIX.length).split(".");
    if (!isUploadRecoveryToken(token) || !payload || !signature || extra !== undefined) throw new Error();
    if (
      !await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        new Uint8Array(decode(signature)),
        new TextEncoder().encode(DOMAIN + payload),
      )
    ) throw new Error();
    const c = JSON.parse(new TextDecoder().decode(decode(payload))) as UploadRecoveryClaims;
    if (
      ![c.grantId, c.agentId, c.groupId, c.meetingId].every((s) => typeof s === "string" && s.length > 0) ||
      !Number.isSafeInteger(c.telegramId) || c.telegramId <= 0 || !Number.isFinite(c.expiresAt) ||
      c.expiresAt <= now || c.expiresAt > now + UPLOAD_RECOVERY_TTL_MS
    ) throw new Error();
    return c;
  } catch {
    throw new Error("invalid or expired upload recovery permit");
  }
}
