"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { RoyHeader, Segmented, RoyCard, Market } from "../ui";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import { fetchMeetings } from "@/lib/api";
import { AgentReviewQueue } from "@/components/AgentReviewQueue";
import type { Entry } from "@/types";

const SEGS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ожидают" },
  { id: "confirmed", label: "Подтверждены" },
];

export function sourceLabel(s: string): string {
  if (s === "granola") return "Granola";
  if (s === "read_ai") return "Read.ai";
  if (s === "desktop-agent") return "Запись";
  return "Встреча";
}
const isConfirmed = (e: Entry) => e.metadata?.confirmed === true;
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

export function RoyMeetingsScreen() {
  const { push } = useRoyNav();
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [seg, setSeg] = useState("all");

  useEffect(() => {
    fetchMeetings()
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, []);

  const items = (meetings ?? []).filter((e) => (seg === "all" ? true : seg === "confirmed" ? isConfirmed(e) : !isConfirmed(e)));

  return (
    <div className="relative h-full overflow-y-auto">
      {/* Очередь вычитки черновиков от рекордера (desktop-agent) — невидима без черновиков */}
      <AgentReviewQueue onOpen={(id) => push({ view: "meetingReview", params: { id } })} />
      <RoyHeader title="Встречи" />
      <div className="px-5 pb-3">
        <Segmented items={SEGS} value={seg} onChange={setSeg} />
      </div>
      <div className="space-y-2.5 px-5 pb-28">
        {meetings == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 72, borderRadius: 18 }} />)}
        {meetings && items.length === 0 && <div className="py-10 text-center text-sm text-ink-soft">Встреч нет</div>}
        {items.map((e) => (
          <button key={e.id} type="button" onClick={() => push({ view: "meetingDetail", params: { id: e.id } })} className="w-full text-left transition-transform active:scale-[0.99]">
            <RoyCard className="flex items-center gap-3 px-4 py-3.5">
              <span className="inline-flex shrink-0 items-center justify-center rounded-[12px]" style={{ width: 38, height: 38, background: "var(--meet-soft)", color: "var(--meet-ink)" }}>
                <RoyIcon name="meet" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 truncate font-semibold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
                  {deriveEntryTitle(e)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "1px 7px" }}>
                    {sourceLabel(e.source)}
                  </span>
                  <Market code={e.countries?.[0]} />
                  {fmtDate(e.entry_date || e.created_at) && (
                    <span className="text-ink-mute" style={{ fontSize: 11 }}>
                      {fmtDate(e.entry_date || e.created_at)}
                    </span>
                  )}
                </div>
              </div>
              <RoyIcon name="cright" size={16} className="shrink-0 text-ink-mute" />
            </RoyCard>
          </button>
        ))}
      </div>
    </div>
  );
}
