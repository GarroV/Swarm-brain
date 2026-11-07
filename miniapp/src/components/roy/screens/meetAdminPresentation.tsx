"use client";
import type * as React from "react";
import type { Entry, AgentMeeting } from "@/types";
import { useDt } from "../nav";
import { RoyCard, SectionLabel } from "../ui";
import { RoyIcon } from "../icons";

const ROW_STATUS_COPY = {
  awaitingReview: { ru: "На вычитке", en: "Awaiting review" },
  pendingReview: { ru: "На согласовании", en: "Pending review" },
} as const;

export const MEET_DETAIL_COPY = {
  saveTitle: { ru: "Сохранить название", en: "Save title" },
  cancel: { ru: "Отмена", en: "Cancel" },
  editTitle: { ru: "Изменить название", en: "Edit title" },
  transcript: { ru: "Транскрипт", en: "Transcript" },
  copy: { ru: "Копировать", en: "Copy" },
  copied: { ru: "Скопировано", en: "Copied" },
} as const;

// Статистика по «Все встречи»: сортированный подсчёт (по убыванию).
export function tally(keys: string[]): [string, number][] {
  const m = new Map<string, number>();
  keys.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function CountsCard({ title, counts }: { title: string; counts: [string, number][] }) {
  if (counts.length === 0) return null;
  return (
    <RoyCard className="px-3.5 py-3">
      <SectionLabel className="!mb-2">{title}</SectionLabel>
      <div className="space-y-1.5">
        {counts.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between gap-2" style={{ fontSize: 13 }}>
            <span className="truncate text-ink-soft">{k}</span>
            <span className="shrink-0 font-bold text-ink">{n}</span>
          </div>
        ))}
      </div>
    </RoyCard>
  );
}

// Чип-переключатель с количеством. Активный — акцентной заливкой, как чипы стран в задачах.
export function FilterChip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold transition-colors ${
        active ? "border-primary bg-accent-soft text-accent-ink" : "border-line bg-surface text-ink-soft hover:bg-surface-2"
      }`}
      style={{ fontSize: 11.5, padding: "3px 9px" }}
    >
      {label}
      {count !== undefined && <span className={active ? "text-accent-ink" : "text-ink-mute"}>{count}</span>}
    </button>
  );
}

export function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionLabel className="!mb-1.5">{title}</SectionLabel>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// ── Типы объединённого списка ────────────────────────────────────────────────

export type MeetItem =
  | { kind: "entry"; data: Entry }
  | { kind: "agent"; data: AgentMeeting };

// ── Стат-плашка ──────────────────────────────────────────────────────────────

export function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className="flex-1 rounded-[8px] border border-line bg-surface px-3 py-2.5"
    >
      <div
        className="font-bold leading-none"
        style={{ fontSize: 24, color: accent ? "var(--accent-ink)" : "var(--ink)" }}
      >
        {value}
      </div>
      <div className="mt-1 font-semibold text-ink-mute" style={{ fontSize: 11 }}>
        {label}
      </div>
    </div>
  );
}

// ── Строка списка ─────────────────────────────────────────────────────────────

export function ListRow({
  item,
  active,
  onClick,
  removing = false,
  itemTitle, itemDate, fmtDate, itemSource, itemRecorder,
}: {
  item: MeetItem;
  active: boolean;
  onClick: () => void;
  removing?: boolean;
  itemTitle: (item: MeetItem) => string;
  itemDate: (item: MeetItem) => string | null;
  fmtDate: (iso: string | null) => string | null;
  itemSource: (item: MeetItem, dt: (ru: string, en: string) => string) => string;
  itemRecorder: (item: MeetItem) => string | null;
}) {
  const dt = useDt();
  const isAgent = item.kind === "agent";
  const title = itemTitle(item);
  const date = fmtDate(itemDate(item));
  const src = itemSource(item, dt);
  // Согласованная встреча (в базе) — не показываем статус-бейдж «На согласовании» (важно в режиме
  // «Все встречи», где список включает уже опубликованные). Черновик агента всегда «На вычитке».
  const confirmedEntry = item.kind === "entry" && (item.data.metadata as Record<string, unknown> | undefined)?.confirmed === true;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={removing}
      // Exit-анимация при согласовании/удалении: затухание + сворачивание (maxHeight) + лёгкий сдвиг.
      className={`block w-full text-left overflow-hidden transition-all duration-300 ease-out${
        removing ? " opacity-0 -translate-x-2 scale-[0.97] pointer-events-none" : " hover:scale-[1.01]"
      }`}
      style={{ maxHeight: removing ? 0 : 260 }}
    >
      <RoyCard
        className="px-3.5 py-3 transition-colors hover:border-line-2 hover:bg-surface-2"
        style={active ? { borderColor: "var(--accent-ink)", background: "var(--accent-soft)" } : {}}
      >
        <div className="flex items-start gap-3">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-[8px]"
            style={{ width: 34, height: 34, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
          >
            <RoyIcon name="meet" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-semibold text-ink"
              style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}
            >
              {title}
            </div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              {!confirmedEntry && (
                <span
                  className="inline-flex items-center font-semibold"
                  style={{
                    fontSize: 10,
                    color: isAgent ? "var(--status-open)" : "var(--meet-ink)",
                    background: isAgent ? "color-mix(in srgb, var(--status-open) 10%, transparent)" : "var(--meet-soft)",
                    borderRadius: 6,
                    padding: "1px 6px",
                  }}
                >
                  {isAgent ? dt(ROW_STATUS_COPY.awaitingReview.ru, ROW_STATUS_COPY.awaitingReview.en) : dt(ROW_STATUS_COPY.pendingReview.ru, ROW_STATUS_COPY.pendingReview.en)}
                </span>
              )}
              <span className="text-ink-mute font-medium" style={{ fontSize: 11 }}>
                {src}
              </span>
              {date && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>
                  {date}
                </span>
              )}
              {itemRecorder(item) && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>· {itemRecorder(item)}</span>
              )}
            </div>
          </div>
        </div>
      </RoyCard>
    </button>
  );
}

// Смещение пометки от старта записи (сек) → «мм:сс» (или «ч:мм:сс» для длинных встреч).
export function formatOffset(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
