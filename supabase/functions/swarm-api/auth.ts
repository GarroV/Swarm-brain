export type VerifiedUser = {
  telegram_id: number;
  language_code: string;
};

/**
 * Verifies Telegram Mini App initData per official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns VerifiedUser on success, null on any failure.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAge: number,
): Promise<VerifiedUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // data-check-string: sorted key=value pairs joined by \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const encoder = new TextEncoder();

  // secret_key = HMAC-SHA256(key="WebAppData", message=BOT_TOKEN)
  const webAppDataKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBytes = await crypto.subtle.sign(
    "HMAC",
    webAppDataKey,
    encoder.encode(botToken),
  );

  // computed_hash = HMAC-SHA256(key=secret_key, message=data-check-string)
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computedHashBytes = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(dataCheckString),
  );
  const computedHash = Array.from(new Uint8Array(computedHashBytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHash !== hash) return null;

  // Freshness check
  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  if (Date.now() / 1000 - authDate > maxAge) return null;

  // Parse user
  const userStr = params.get("user");
  if (!userStr) return null;
  let user: { id: number; language_code?: string };
  try {
    user = JSON.parse(userStr);
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return {
    telegram_id: user.id,
    language_code: user.language_code ?? "en",
  };
}
