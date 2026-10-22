"use client";
import type { SprintCycleItem, User } from "@/types";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { fmtDay, fmtDayShort } from "./format";

// Снимок ушедшей задачи (решение владельца 22.10.2026): строка спринта, из которого задачу
// перенесли, остаётся в нём серой пунктирной карточкой — куда ушла, как сдвинулся срок, почему,
// кто и когда. В счёт спринта снимок не идёт. Без причины — красная просьба вписать её; это
// единственное место, где причину спрашивают после переноса (автоматика по сроку её не знает).
// Карточку переиспользует доска спринтов (этап 3).

export function SnapshotCard({ item, users, onAddReason }: {
  item: SprintCycleItem;
  users: ReadonlyArray<Pick<User, "telegram_id" | "name">>;
  /** Нет — причину вписать нельзя (принятый спринт): просьба только показывается. */
  onAddReason?: (item: SprintCycleItem) => void;
}) {
  const dt = useDt();
  const m = item.moved;
  if (!m) return null;
  const auto = m.by === null;
  const who = auto
    ? dt("автоматически", "automatically")
    : users.find((u) => u.telegram_id === m.by)?.name ??
      dt("кто-то", "someone");
  const dueFrom = item.due_date;
  const dueTo = m.due_now;
  const dueText = dueFrom && dueTo && dueFrom !== dueTo
    ? `${fmtDayShort(dueFrom)} → ${fmtDayShort(dueTo)}`
    : dueFrom ?? dueTo
    ? fmtDayShort((dueFrom ?? dueTo)!)
    : null;
  const where = m.to_cycle_id
    ? dt(
      `перенесена → ${m.to_cycle_name ?? "?"}`,
      `moved → ${m.to_cycle_name ?? "?"}`,
    )
    : dt("перенесена (спринт удалён)", "moved (sprint deleted)");

  return (
    <div
      className="rounded-[10px] border border-dashed border-line-2 bg-surface-2/60 px-3 py-2 text-ink-mute"
      style={{ fontSize: 12 }}
    >
      <div className="truncate text-[13px] text-ink-soft">{item.title}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-1.5">
        <span>{where}</span>
        {dueText && (
          <span>
            · {dt("срок", "due")} <span className="font-mono">{dueText}</span>
          </span>
        )}
        {auto && <span>· {dt("сменили срок", "deadline changed")}</span>}
      </div>
      <div className="mt-0.5">
        {m.reason
          ? (
            <span>
              {dt("Причина", "Reason")}: «{m.reason}» · {who} · {fmtDay(m.at)}
            </span>
          )
          : onAddReason
          ? (
            <button
              type="button"
              onClick={() => onAddReason(item)}
              className="font-semibold text-pri-high underline-offset-2 hover:underline"
            >
              {dt(
                "причина не указана — нажмите, чтобы вписать",
                "no reason given — click to add one",
              )}
            </button>
          )
          : (
            <span className="font-semibold text-pri-high">
              {dt("причина не указана", "no reason given")}
            </span>
          )}
      </div>
    </div>
  );
}

/** Блок «Ушли из спринта» под составом: снимки по дате ухода, свежие сверху. */
export function MovedSection({ items, users, onAddReason, className }: {
  items: SprintCycleItem[];
  users: ReadonlyArray<Pick<User, "telegram_id" | "name">>;
  onAddReason?: (item: SprintCycleItem) => void;
  className?: string;
}) {
  const dt = useDt();
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) =>
    (b.moved?.at ?? "").localeCompare(a.moved?.at ?? "")
  );
  return (
    <section className={cn("mt-4", className)}>
      <div
        className="mb-1.5 flex items-center gap-2 px-0.5 font-semibold uppercase tracking-[0.06em] text-ink-mute"
        style={{ fontSize: 11 }}
      >
        {dt("Ушли из спринта", "Left the sprint")}
        <span className="font-mono">{items.length}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {sorted.map((it) => (
          <SnapshotCard
            key={it.id}
            item={it}
            users={users}
            onAddReason={onAddReason}
          />
        ))}
      </div>
    </section>
  );
}
