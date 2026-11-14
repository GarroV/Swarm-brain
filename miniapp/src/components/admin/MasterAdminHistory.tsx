"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/roy/nav";
import { formatDate } from "@/lib/displayFormat";
import { fetchMasterAdminHistory, MASTER_ADMIN_HISTORY_COPY, type MasterAdminEvent } from "@/lib/masterAdminHistory";

export function MasterAdminHistory({ revision }: { revision: number }) {
  const copy = MASTER_ADMIN_HISTORY_COPY[useLang()];
  const [rows, setRows] = useState<MasterAdminEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    fetchMasterAdminHistory().then((items) => {
      if (active) { setRows(items); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [revision, retry]);

  return (
    <section className="mt-4 border-t border-line pt-3" aria-label={copy.heading}>
      <h4 className="text-sm font-semibold text-ink">{copy.heading}</h4>
      <p className="mt-0.5 text-xs text-ink-mute">{copy.recent}</p>
      {failed ? (
        <div className="mt-2 text-sm">
          <p role="alert" className="text-destructive">{copy.error}</p>
          <button type="button" className="mt-1 text-ink-soft underline" onClick={() => setRetry((n) => n + 1)}>{copy.retry}</button>
        </div>
      ) : rows === null ? (
        <div className="roy-shim mt-2 h-10 rounded-lg" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-mute">{copy.empty}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg bg-surface-2 px-2.5 py-2 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold text-ink">{copy[row.action]}</span>
                <time className="text-ink-mute" dateTime={row.created_at}>
                  {formatDate(row.created_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) ?? "—"}
                </time>
              </div>
              <p className="mt-1 break-words text-ink-soft">{copy.actor}: {row.actor_name || row.actor_telegram_id}</p>
              <p className="break-words text-ink-soft">{copy.target}: {row.target_name || row.target_telegram_id}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
