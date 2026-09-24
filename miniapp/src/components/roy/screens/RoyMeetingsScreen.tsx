"use client";
import { useCallback, useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { RoyHeader, Segmented, RoyCard, Market, StorageBadge } from "../ui";
import { HeaderActions } from "../HeaderActions";
import { RoyIcon, type RoyIconName } from "../icons";
import { SwipeRow } from "../SwipeRow";
import { useIsDesktop } from "../useIsDesktop";
import { deriveEntryTitle, entryImporterName } from "../entry";
import { fetchMeetings, deleteMeeting } from "@/lib/api";
import { AgentReviewQueue } from "@/components/AgentReviewQueue";
import { MeetingsDesk } from "./MeetingsDesk";
import { useConfirm } from "@/components/ui/confirm";
import type { Entry } from "@/types";

const SEGS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ожидают" },
  { id: "confirmed", label: "Подтверждены" },
];

export function sourceLabel(s: string): string {
  if (s === "granola") return "Granola";
  if (s === "read_ai") return "Read.ai";
  if (s === "desktop-agent") return "bumblebee";
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
      className="flex items-center justify-center rounded-[7px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
      style={{ width: 30, height: 30, color }}
    >
      <RoyIcon name={name} size={15} strokeWidth={1.9} />
    </button>
  );
}

// Строка встречи. На мобайле действия спрятаны в свайп — тот же жест, что у задач: две
// кнопки 36x36 вплотную в строке были и мелкой целью, и риском случайного удаления (владелец
// 2026-08-22: «лаконичное логичное меню»). На десктопе действия остаются на виду: там мышь,
// свайпать нечем.
function MeetingCard({ e, onOpen, onRemove, mobile }: { e: Entry; onOpen: () => void; onRemove: () => void; mobile?: boolean }) {
  const who = entryImporterName(e);
  const body = (
    <div className="relative">
      <button type="button" onClick={mobile ? undefined : onOpen} className="block w-full text-left transition-transform active:scale-[0.99]">
        <RoyCard className="flex items-center gap-3 px-4 py-3.5">
          <span className="inline-flex shrink-0 items-center justify-center rounded-[8px]" style={{ width: 32, height: 32, background: "var(--meet-soft)", color: "var(--meet-ink)" }}>
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
              {isConfirmed(e) && <StorageBadge isPrivate={e.is_private} />}
              <Market code={e.countries?.[0]} />
              {fmtDate(e.entry_date || e.created_at) && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>
                  {fmtDate(e.entry_date || e.created_at)}
                </span>
              )}
              {who && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>· {who}</span>
              )}
            </div>
          </div>
          {!mobile && <span className="shrink-0" style={{ width: 90 }} />}
        </RoyCard>
      </button>
      {!mobile && (
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          <ActionIcon name="pencil" label="Изменить" color="var(--accent-ink)" onClick={onOpen} />
          <ActionIcon name="trash" label="Удалить" color="var(--pri-high)" onClick={onRemove} />
        </div>
      )}
    </div>
  );
  if (!mobile) return body;
  return (
    <SwipeRow
      onTap={onOpen}
      actions={[
        { icon: "pencil", label: "Изменить", color: "var(--accent-ink)", onClick: onOpen },
        { icon: "trash", label: "Удалить", color: "var(--pri-high)", onClick: onRemove },
      ]}
    >
      {body}
    </SwipeRow>
  );
}

export function RoyMeetingsScreen() {
  const { push, toast } = useRoyNav();
  const dt = useDt();
  const confirm = useConfirm();
  const isDesktop = useIsDesktop();
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
  const all = meetings ?? [];
  const items = all.filter((e) => (seg === "all" ? true : seg === "confirmed" ? isConfirmed(e) : !isConfirmed(e)));

  const open = (id: string) => push({ view: "meetingDetail", params: { id } });
  const remove = async (e: Entry) => {
    if (!(await confirm({ title: `Удалить встречу «${deriveEntryTitle(e)}»?`, description: "Встреча и её расшифровка будут удалены без возможности восстановления." }))) return;
    setMeetings((prev) => prev?.filter((x) => x.id !== e.id) ?? null);
    try {
      await deleteMeeting(e.id);
      toast("Встреча удалена");
    } catch {
      toast("Не удалось удалить");
      load();
    }
  };
  const openReview = (id: string) => push({ view: "meetingReview", params: { id } });

  const segmented = <Segmented items={SEGS} value={seg} onChange={setSeg} />;
  const skeleton = meetings == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 72, borderRadius: 10 }} />);
  const emptyFeed = meetings && items.length === 0 && <div className="py-10 text-center text-sm text-ink-soft">Встреч нет</div>;
  const feedCards = (mobile: boolean) =>
    items.map((e) => <MeetingCard key={e.id} e={e} mobile={mobile} onOpen={() => open(e.id)} onRemove={() => remove(e)} />);

  // ── Десктоп: таблица по стенду (MeetingsDesk) ─────────────────────────────────
  if (isDesktop) return <MeetingsDesk />;

  // ── Мобайл: стопкой (как было) ───────────────────────────────────────────────
  return (
    <div className="relative h-full overflow-y-auto">
      <RoyHeader title={dt("Встречи", "Meetings")} right={<HeaderActions />} />
      {/* Очередь вычитки — ПОД заголовком экрана, а не над ним: блок «На вычитке» висел выше
          h1 и читался как отдельный экран без названия. */}
      <AgentReviewQueue onOpen={openReview} />
      <div className="px-5 pb-3 pt-3">{segmented}</div>
      <div className="space-y-2.5 px-5 pb-28">
        {skeleton}
        {emptyFeed}
        {feedCards(true)}
      </div>
    </div>
  );
}
