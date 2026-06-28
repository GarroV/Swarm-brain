"use client";
import type { ReactNode } from "react";
import { RoyCard } from "../ui";
import { RoyIcon, type RoyIconName } from "../icons";

// Общий каркас панелей desktop-главного экрана «Рой». Вынесено из RoyDashboard,
// чтобы пять панелей (PersonalTasks/SearchHero/Materials/MeetingsApprove/TeamTasks)
// делили один скелет: шапка-кнопка → раскрытие во вкладку/экран, скролл-тело,
// loading (roy-shim) и empty-состояние. Flat, тонкие границы — без бенто-визуала.

// ── Форматирование даты «Рой» (ru, day + short month) ───────────────────────────
export function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

// Инициалы для аватара. Сырой telegram_id (только цифры) → «Я» (себя не подписываем числом).
export function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

// Относительное время «N мин / N ч / N дн» от now до created_at (для ленты материалов).
export function relTime(iso: string | null, now: number): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "сейчас";
  if (min < 60) return `${min} мин`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч`;
  const days = Math.floor(hrs / 24);
  return `${days} дн`;
}

// Нормализация статуса задачи: устаревший alias "progress" → "in_progress".
export const norm = (s: string): string => (s === "progress" ? "in_progress" : s);

// ── Панель: шапка-кнопка (раскрыть) + скроллируемое тело ─────────────────────────
export function DashBlock({
  title, icon, tint, badge, headAction, loading, empty, emptyText, onHead, children, className,
}: {
  title: string;
  icon: RoyIconName;
  tint: string;
  /** правый бейдж в шапке (например «3 новых» / «N на согласовании») */
  badge?: ReactNode;
  /** правый текст-действие шапки (например «Доска ›») */
  headAction?: ReactNode;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  onHead: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RoyCard className={`flex min-h-0 flex-col overflow-hidden p-0 ${className ?? ""}`}>
      <button
        type="button"
        onClick={onHead}
        className="group flex shrink-0 items-center justify-between border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-[9px]"
            style={{ width: 28, height: 28, color: tint, backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)` }}
          >
            <RoyIcon name={icon} size={16} strokeWidth={2} />
          </span>
          <span className="truncate font-bold text-ink" style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}>
            {title}
          </span>
          {badge}
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-ink-mute transition-colors group-hover:text-primary"
          style={{ fontSize: 12.5 }}
        >
          {headAction ?? "Открыть"}
          <RoyIcon name="cright" size={14} strokeWidth={2} />
        </span>
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2">
        {loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim" style={{ height: 52, borderRadius: 12 }} />)}
        {!loading && empty && <div className="py-10 text-center text-sm text-ink-soft">{emptyText}</div>}
        {!loading && !empty && children}
      </div>
    </RoyCard>
  );
}

// ── Бейдж-счётчик «требует внимания» (акцент) ───────────────────────────────────
export function AccentBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink" style={{ fontSize: 12 }}>
      {children}
    </span>
  );
}

// ── Строка-кнопка тела панели ───────────────────────────────────────────────────
export function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

// ── Мелкий лейбл подсекции внутри панели (Сегодня / На неделе) ───────────────────
export function SubHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-1">
      <span className="font-mono font-semibold uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.09em" }}>
        {children}
      </span>
      {count != null && (
        <span className="font-mono font-bold text-accent-ink" style={{ fontSize: 11 }}>
          {count}
        </span>
      )}
      <span className="ml-1 h-px flex-1 bg-line" />
    </div>
  );
}

// ── Статус-пилюля задачи (open / in_progress) ───────────────────────────────────
export function StatusPill({ status }: { status: string }) {
  const isProg = status === "in_progress";
  const color = isProg ? "var(--status-prog)" : "var(--status-open)";
  const label = isProg ? "В работе" : "Открыто";
  return (
    <span
      className="inline-flex items-center font-semibold"
      style={{ fontSize: 11, color, background: `color-mix(in srgb, ${color} 14%, transparent)`, borderRadius: 6, padding: "1px 7px" }}
    >
      {label}
    </span>
  );
}
