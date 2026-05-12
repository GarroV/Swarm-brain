const GOOGLE_CLIENT_EMAIL = Deno.env.get("GOOGLE_CLIENT_EMAIL") ?? "";
const GOOGLE_PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") ?? "";

export async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });
  const toSign = `${header}.${payload}`;

  const pemKey = GOOGLE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${toSign}.${sigB64}` }),
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function getOrCreateDriveFolder(name: string, parentId: string, token: string): Promise<string> {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as { files: Array<{ id: string }> };
  if (data.files?.length) return data.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const created = await createRes.json() as { id: string };
  return created.id;
}

export async function uploadToDrive(fileName: string, buffer: ArrayBuffer, mimeType: string, subFolder: string): Promise<{ link: string | null; error: string | null }> {
  if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_CLIENT_EMAIL) return { link: null, error: "GOOGLE_DRIVE_FOLDER_ID или GOOGLE_CLIENT_EMAIL не заданы" };
  try {
    const token = await getGoogleAccessToken();
    const folderId = await getOrCreateDriveFolder(subFolder, GOOGLE_DRIVE_FOLDER_ID, token);

    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const boundary = "boundary_swarm";
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const bodyEnd = `\r\n--${boundary}--`;
    const bodyBytes = new TextEncoder().encode(body);
    const endBytes = new TextEncoder().encode(bodyEnd);
    const fileBytes = new Uint8Array(buffer);
    const combined = new Uint8Array(bodyBytes.length + fileBytes.length + endBytes.length);
    combined.set(bodyBytes); combined.set(fileBytes, bodyBytes.length); combined.set(endBytes, bodyBytes.length + fileBytes.length);

    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: combined,
    });
    const result = await res.json() as { id?: string; webViewLink?: string; error?: { message?: string } };
    if (result.error) return { link: null, error: result.error.message ?? JSON.stringify(result.error) };
    if (!result.id) return { link: null, error: `Нет id в ответе: ${JSON.stringify(result)}` };
    return { link: result.webViewLink ?? `https://drive.google.com/file/d/${result.id}/view`, error: null };
  } catch (e) {
    return { link: null, error: e instanceof Error ? e.message : String(e) };
  }
}
