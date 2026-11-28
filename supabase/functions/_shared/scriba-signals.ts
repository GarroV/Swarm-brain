import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SignalKind = "invite" | "calendar";
export interface SignalRow {
  kind: SignalKind;
  work_id: string;
  lease_id: string;
  attempts: number;
}
export interface SignalStore {
  take(target?: { kind: SignalKind; id: string }): Promise<SignalRow[]>;
  finish(row: SignalRow, ok: boolean, reason: string | null): Promise<void>;
}
export const SIGNAL_HEADER = "X-Scriba-Signal-Secret";
export const SIGNAL_TIMEOUT_MS = 30_000;

/** Compare fixed-size digests; never log either the supplied or configured credential. */
export async function signalAuthorized(req: Request, expected: string): Promise<boolean> {
  const supplied = req.headers.get(SIGNAL_HEADER) ?? "";
  if (expected.length < 32 || supplied.length > 512) return false;
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(expected), digest(supplied)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

export function makeSignalStore(db: SupabaseClient): SignalStore {
  return {
    async take(target) {
      const { data, error } = await db.rpc("scriba_lease_signals", {
        p_limit: target ? 1 : 3,
        p_kind: target?.kind ?? null,
        p_id: target?.id ?? null,
      });
      if (error) throw new Error("signal lease failed");
      return (data ?? []) as SignalRow[];
    },
    async finish(row, ok, reason) {
      const { data, error } = await db.rpc("scriba_finish_signal", {
        p_kind: row.kind,
        p_id: row.work_id,
        p_lease: row.lease_id,
        p_ok: ok,
        p_error: reason,
      });
      if (error || data !== true) throw new Error("signal receipt was not stored");
    },
  };
}

export async function deliverSignals(deps: {
  store: SignalStore;
  url: string;
  secret: string;
  fetch?: typeof fetch;
  target?: { kind: SignalKind; id: string };
}): Promise<{ acknowledged: number; retrying: number }> {
  // Misconfiguration leaves the database queue intact; neither a fake ACK nor a lost attempt.
  if (!deps.url || deps.secret.length < 32) throw new Error("signal delivery is not configured");
  const targetUrl = new URL(deps.url);
  if (targetUrl.protocol !== "http:" || targetUrl.username || targetUrl.password || targetUrl.pathname !== "/signal") {
    throw new Error("signal URL must use the private HTTP listener");
  }
  const result = { acknowledged: 0, retrying: 0 };
  const rows = await deps.store.take(deps.target);
  const send = deps.fetch ?? fetch;
  // One bounded three-way wave: 30s for grant/notice resolution, below the 90s lease.
  for (let offset = 0; offset < rows.length; offset += 3) {
    await Promise.all(
      rows.slice(offset, offset + 3).map(async (row) => {
        let ok = false;
        let reason = "unavailable";
        try {
          const response = await send(targetUrl, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS),
            headers: { "Content-Type": "application/json", [SIGNAL_HEADER]: deps.secret },
            body: JSON.stringify({ kind: row.kind, id: row.work_id }),
          });
          ok = response.ok && (await response.json().catch(() => null))?.ok === true;
          reason = response.ok ? "invalid_receipt" : `http_${response.status}`;
        } catch {
          // Error strings can contain addresses or header values; persist a bounded code only.
          reason = "unavailable";
        }
        await deps.store.finish(row, ok, ok ? null : reason);
        if (ok) result.acknowledged++;
        else result.retrying++;
      }),
    );
  }
  return result;
}

export function dispatchScribaSignals(db: SupabaseClient, target?: { kind: SignalKind; id: string }) {
  return deliverSignals({
    store: makeSignalStore(db),
    url: Deno.env.get("SCRIBA_SIGNAL_URL") ?? "",
    secret: Deno.env.get("SCRIBA_SIGNAL_SECRET") ?? "",
    target,
  });
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
/** Fast path after commit; the durable cron retries if this request/runtime disappears. */
export async function kickScribaSignal(db: SupabaseClient, kind: SignalKind, id: string): Promise<void> {
  const work = dispatchScribaSignals(db, { kind, id }).catch(() => {
    console.warn("scriba-signal: immediate delivery pending; durable queue will retry");
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) EdgeRuntime.waitUntil(work);
  else await work;
}
