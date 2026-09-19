"use client";
import type { CheckStatus } from "@/types";
import type { Progress } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { fmtDay, isOverdue } from "./format";

// Мелкие детали доски инициатив: полоска прогресса, отметка сверки, «×N» переноса,
// исполнитель, срок. Вынесены отдельно, потому что одни и те же метки стоят в четырёх
// местах — список спринта, «Все инициативы», сверка, аналитика, — и нарисованные заново
// в каждом они начинают означать разное: серый «риск» в одном экране и жёлтый в другом.

/** Полоска выполнения. Пустой прогресс рисуем серой полосой, а не пустотой: иначе
 *  «ничего не сделано» и «не загрузилось» выглядят одинаково. */
export function ProgressBar({ percent, className = "" }: {
  percent: number;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-surface-2 ${className}`}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** «3/8 · 38%» — цифры рядом с полоской. */
export function ProgressText({ progress }: { progress: Progress }) {
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-ink-soft">
      {progress.done}/{progress.total} · {progress.percent}%
    </span>
  );
}

const CHECK_TONE: Record<CheckStatus, string> = {
  ok: "border-status-done/40 bg-status-done/10 text-status-done",
  risk: "border-pri-med/40 bg-pri-med/10 text-pri-med",
  problem: "border-pri-high/40 bg-pri-high/10 text-pri-high",
};

/**
 * Отметка сверки. `unchecked` — не «нет данных», а состояние «человек промолчал»: показываем
 * его ТОЛЬКО с дня сверки (D013), иначе вся доска с первого дня стоит в серых пометках.
 */
export function CheckBadge(
  { status, note, unchecked = false }: {
    status: CheckStatus | null;
    note?: string | null;
    unchecked?: boolean;
  },
) {
  const dt = useDt();
  if (status === null) {
    if (!unchecked) return null;
    return (
      <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
        {dt("не отмечено", "not checked")}
      </span>
    );
  }
  const label = status === "ok"
    ? dt("по плану", "on track")
    : status === "risk"
    ? dt("риск", "at risk")
    : dt("проблема", "problem");
  return (
    <span
      title={note ?? undefined}
      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
        CHECK_TONE[status]
      }`}
    >
      {label}
      {note ? " ·" : ""}
    </span>
  );
}

/**
 * «×N» у задачи, которая переезжает не первый раз (D012). С единицы не показываем: один
 * перенос — обычное дело, а метка на каждой второй строке перестаёт быть сигналом.
 */
export function CarryBadge({ count, reason }: {
  count: number;
  reason?: string | null;
}) {
  const dt = useDt();
  if (count < 2) return null;
  return (
    <span
      title={reason ??
        dt(`переносилась ${count} раза`, `carried over ${count} times`)}
      className="inline-flex items-center gap-0.5 rounded-full border border-pri-med/40 bg-pri-med/10 px-1.5 py-0.5 text-[10px] font-semibold text-pri-med"
    >
      <RoyIcon name="repeat" size={9} strokeWidth={2.5} />×{count}
    </span>
  );
}

/** Метка «к переносу»: человек уже сказал, что задача уедет, — до приёмки это видно всем. */
export function CarryFlag({ reason }: { reason?: string | null }) {
  const dt = useDt();
  return (
    <span
      title={reason ?? undefined}
      className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft"
    >
      {dt("к переносу", "to carry")}
    </span>
  );
}

/** Исполнитель. Без исполнителя строка тоже подписана — иначе «ничей» незаметен. */
export function AssigneeChip({ name }: { name: string | null }) {
  const dt = useDt();
  return (
    <span
      className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] ${
        name
          ? "bg-surface-2 text-ink-soft"
          : "border border-dashed border-line text-ink-soft/60"
      }`}
    >
      {name ?? dt("без исполнителя", "unassigned")}
    </span>
  );
}

/** Срок задачи. Красным — только у незакрытой: у сделанной просрочка уже ничего не значит. */
export function DueBadge({ date, closed = false }: {
  date: string;
  closed?: boolean;
}) {
  const late = !closed && isOverdue(date);
  return (
    <span
      className={`whitespace-nowrap text-[10px] tabular-nums ${
        late ? "font-semibold text-pri-high" : "text-ink-soft"
      }`}
    >
      {fmtDay(date)}
    </span>
  );
}
