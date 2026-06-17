"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { RoyHeader, Segmented, RoyCard, Market } from "../ui";
import { RoyIcon, type RoyIconName } from "../icons";
import { deriveEntryTitle } from "../entry";
import { fetchMeetings, deleteMeeting } from "@/lib/api";
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

function ActionIcon({ name, label, color, onClick }: { name: RoyIconName; label: string; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      className="flex items-center justify-center rounded-[10px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
      style={{ width: 32, height: 32, color }}
    >
      <RoyIcon name={name} size={16} strokeWidth={1.9} />
    </button>
  );
}

export function RoyMeetingsScreen() {
  const { push, toast } = useRoyNav();
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [seg, setSeg] = useState("all");

  const load = useCallback(() => {
    fetchMeetings()
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const items = (meetings ?? []).filter((e) => (seg === "all" ? true : seg === "confirmed" ? isConfirmed(e) : !isConfirmed(e)));

  const open = (id: string) => push({ view: "meetingDetail", params: { id } });
  const remove = async (e: Entry) => {
    if (typeof window !== "undefined" && !window.confirm(`Удалить встречу «${deriveEntryTitle(e)}»? Это удалит и расшифровку.`)) return;
    setMeetings((prev) => prev?.filter((x) => x.id !== e.id) ?? null);
    try {
      await deleteMeeting(e.id);
      toast("Встреча удалена");
    } catch {
      toast("Не удалось удалить");
      load();
    }
  };

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
          <div key={e.id} className="relative">
            <button type="button" onClick={() => open(e.id)} className="block w-full text-left transition-transform active:scale-[0.99]">
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
                {/* место под всегда-видимые кнопки действий справа */}
                <span className="shrink-0" style={{ width: 70 }} />
              </RoyCard>
            </button>
            {/* Быстрые действия — всегда видимы (правка / удаление) */}
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              <ActionIcon name="pencil" label="Изменить" color="var(--status-open)" onClick={() => open(e.id)} />
              <ActionIcon name="trash" label="Удалить" color="var(--pri-high)" onClick={() => remove(e)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
