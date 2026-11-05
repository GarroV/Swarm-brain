"use client";
import { useEffect, useState } from "react";
import { fetchReviewCounts, type ReviewCount } from "@/lib/api";
import { useSpacesText } from "@/components/admin/spacesText";

// «Очередь вычитки» пространства: у кого копятся непроверенные встречи. Только имя и число —
// сами встречи приватны их владельцу. Берётся по выбранному пространству, а не по домашнему
// пространству смотрящего (раньше мастер-админ видел только своё).
const COLS = "minmax(0,1fr) 120px";

export function WorkspaceReview({ wsId }: { wsId: string }) {
  const t = useSpacesText();
  const [rows, setRows] = useState<ReviewCount[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRows(null); setFailed(false);
    fetchReviewCounts(wsId)
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { console.error("[WorkspaceReview]", e); if (live) setFailed(true); });
    return () => { live = false; };
  }, [wsId]);
  const total = (rows ?? []).reduce((n, r) => n + r.count, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-ink-mute" style={{ fontSize: 12.5 }}>
        <span>{t("reviewNote")}</span>
        {rows && <span className="ml-auto whitespace-nowrap">{t("reviewTotal")} <b className="text-ink">{total}</b></span>}
      </div>
      {failed && <p className="text-ink-soft" style={{ fontSize: 13 }}>{t("loadFailed")}</p>}
      {!rows && !failed && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 34, borderRadius: 8 }} />)}
      {rows && rows.length === 0 && (
        <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center text-ink-soft" style={{ fontSize: 13 }}>{t("reviewEmpty")}</div>
      )}
      {rows && rows.length > 0 && (
        <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface" style={{ fontSize: 13 }}>
          <div role="row" className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
            style={{ gridTemplateColumns: COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
            <span className="px-3">{t("reviewMember")}</span>
            <span className="px-3 text-right">{t("reviewTotal")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.telegram_id} role="row" className="grid items-center border-b border-line last:border-b-0" style={{ gridTemplateColumns: COLS, minHeight: 36 }}>
              <span className="truncate px-3 font-medium text-ink">{r.name}</span>
              <span className="px-3 text-right font-mono font-semibold text-accent-ink" style={{ fontSize: 12.5 }}>{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
