const SECRET = "smoke-signal-secret-for-isolated-test";

export function smokeSignalEnvironment(port: number): Record<string, string> {
  return {
    SCRIBA_SIGNAL_SECRET: SECRET,
    SCRIBA_SIGNAL_HOST: "127.0.0.1",
    SCRIBA_SIGNAL_PORT: String(port),
  };
}

export async function sendSmokeSignal(port: number, id: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scriba-Signal-Secret": SECRET },
    body: JSON.stringify({ kind: "invite", id }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`work signal: ${String(response.status)}`);
}
