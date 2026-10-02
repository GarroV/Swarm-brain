"use client";
// Свежесть источников и действия админа: очередь кандидатов от сборщиков (принять /
// отклонить, «принять все новые точки» для первичной заливки) и загрузка снимка ручных
// источников. Красным — авто-источник, который упал или молчит дольше STALE_DAYS.
import { useCallback, useEffect, useState } from "react";
import type { MarketBundle, MarketCandidate } from "@/types";
import {
  acceptAllMarketLocations,
  ApiError,
  decideMarketCandidate,
  fetchMarketCandidates,
  importMarketSnapshot,
} from "@/lib/api";
import { freshness, STALE_DAYS } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { adapterName, daysAgo, Section } from "./ui";

const FEED: Record<string, [string, string]> = {
  locations: ["точки", "locations"],
  financials: ["финансы", "financials"],
  dodo: ["продажи Dodo", "Dodo sales"],
  prices: ["цены", "prices"],
  facts: ["факты рынка", "market facts"],
};
const KIND: Record<MarketCandidate["kind"], [string, string]> = {
  new_location: ["новая точка", "new location"],
  maybe_closed: ["возможно закрыта", "maybe closed"],
  financial_update: ["новые цифры", "new figures"],
};

function candidateLabel(c: MarketCandidate): string {
  const r = c.payload.row ?? {};
  return [r.name, r.city, r.address, r.year].filter((v) => v !== undefined && v !== null && v !== "").join(" · ") ||
    c.payload.key;
}

function Candidates({ cc, onChanged }: { cc: string; onChanged: () => void }) {
  const dt = useDt();
  const [list, setList] = useState<MarketCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchMarketCandidates(cc).then(setList).catch((e) => {
      console.error("[Freshness] candidates", e);
      setError(dt("Очередь не загрузилась.", "Queue failed to load."));
    });
  }, [cc, dt]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      console.error("[Freshness] decide", e);
      setError(dt("Не получилось — попробуйте ещё раз.", "Failed — try again."));
    } finally {
      setBusy(false);
    }
  };
  if (!list) return error ? <p className="text-destructive" style={{ fontSize: 12 }}>{error}</p> : null;
  if (!list.length) return <p className="text-ink-mute" style={{ fontSize: 12 }}>{dt("Очередь пуста.", "Queue is empty.")}</p>;
  const newCount = list.filter((c) => c.kind === "new_location").length;
  return (
    <div>
      {newCount > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => acceptAllMarketLocations(cc))}
          className="mb-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-accent-ink disabled:opacity-50"
          style={{ fontSize: 12 }}
        >
          {dt(`Принять все новые точки (${newCount}) как «не проверено»`, `Accept all new locations (${newCount}) as unverified`)}
        </button>
      )}
      {error && <p className="mb-2 text-destructive" style={{ fontSize: 12 }}>{error}</p>}
      <ul className="max-h-[260px] space-y-1 overflow-auto" style={{ fontSize: 12 }}>
        {list.slice(0, 200).map((c) => (
          <li key={c.id} className="flex items-center gap-2 border-t border-line py-1.5">
            <span className="w-28 shrink-0 text-ink-mute">{dt(...KIND[c.kind])}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{candidateLabel(c)}</span>
            <button type="button" disabled={busy} onClick={() => act(() => decideMarketCandidate(c.id, true))} className="text-accent-ink disabled:opacity-50">
              {dt("Принять", "Accept")}
            </button>
            <button type="button" disabled={busy} onClick={() => act(() => decideMarketCandidate(c.id, false))} className="text-ink-mute disabled:opacity-50">
              {dt("Отклонить", "Reject")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SnapshotUpload({ cc, onChanged }: { cc: string; onChanged: () => void }) {
  const dt = useDt();
  const [state, setState] = useState<{ ok?: string; errors?: string[] } | null>(null);
  const onFile = async (file: File) => {
    setState(null);
    try {
      const counts = await importMarketSnapshot(cc, JSON.parse(await file.text()));
      setState({ ok: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") });
      onChanged();
    } catch (e) {
      const details = e instanceof ApiError ? (e.body as { details?: string[] } | undefined)?.details : undefined;
      setState({ errors: details ?? [e instanceof SyntaxError ? dt("Файл — не JSON.", "Not a JSON file.") : String(e)] });
    }
  };
  return (
    <div style={{ fontSize: 12 }}>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-ink-soft hover:bg-surface-2">
        {dt("Загрузить снимок ручных источников (.json)", "Upload manual sources snapshot (.json)")}
        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {state?.ok && <p className="mt-1.5 text-ink-soft">{dt("Загружено: ", "Imported: ")}{state.ok}</p>}
      {state?.errors && (
        <ul className="mt-1.5 list-disc pl-5 text-destructive">
          {state.errors.slice(0, 20).map((er) => <li key={er}>{er}</li>)}
        </ul>
      )}
    </div>
  );
}

export function Freshness({ bundle, isAdmin, onChanged }: { bundle: MarketBundle; isAdmin: boolean; onChanged: () => void }) {
  const dt = useDt();
  const rows = freshness(bundle.sources, bundle.runs, new Date());
  return (
    <Section title={dt("Источники и свежесть", "Sources and freshness")}>
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.adapter}:${r.feeds}`} className="border-t border-line align-top">
              <td className="py-1.5 pr-3 text-ink">{adapterName(dt, r.adapter)}</td>
              <td className="py-1.5 pr-3 text-ink-soft">{FEED[r.feeds] ? dt(...FEED[r.feeds]) : r.feeds}</td>
              <td className={`py-1.5 ${r.bad ? "text-destructive" : "text-ink-soft"}`}>
                {r.mode === "auto" ? daysAgo(dt, r.lastOk) : r.reason ?? `${dt("вручную", "manual")} · ${daysAgo(dt, r.lastOk)}`}
                {r.lastError && <div className="text-destructive">{dt("Последний запуск упал: ", "Last run failed: ")}{r.lastError}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
        {dt(
          `Сбор идёт раз в неделю, реестры — в первую неделю месяца. Красным — упал или молчит дольше ${STALE_DAYS} дней.`,
          `Collected weekly; registries in the first week of the month. Red — failed or silent for over ${STALE_DAYS} days.`,
        )}
      </p>
      {isAdmin && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <h3 className="text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Кандидаты от сборщиков", "Collector candidates")} <span className="text-ink-mute">{bundle.pending}</span>
          </h3>
          <Candidates cc={bundle.country} onChanged={onChanged} />
          <SnapshotUpload cc={bundle.country} onChanged={onChanged} />
        </div>
      )}
    </Section>
  );
}
