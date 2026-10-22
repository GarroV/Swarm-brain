"use client";
import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycle } from "@/types";
import { fetchSprintJourney, setSprintTaskSpan } from "@/lib/api";
import { cycleDates, cycleShort, dueCycleOf } from "@/lib/sprintLabels";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { fmtDayShort } from "./format";
import { PILL_BTN } from "./atoms";

// «Спринты задачи…» (решение владельца 22.10.2026, Р5): план работы — непрерывный отрезок
// спринтов пространства, который задают заранее. Выбор — двумя кликами: «с» и «по». Прошлые
// спринты не показываем (выбрать их нельзя), идущий в рамке, спринт срока — флажок 🏁. Срок
// задачи сохранение не меняет. Если конец позже срока или отрезок продлевает задачу из идущего —
// красная подсказка и обязательная причина (то же правило, что в базе, sprint_set_task_span).

export function SpanDialog(
  { task, cycles, current, onClose, onDone }: {
    /** `null` — окно закрыто. */
    task: { id: string; title: string; due: string | null } | null;
    /** Все спринты пространства. */
    cycles: readonly SprintCycle[];
    /** Спринты, где задача живёт сейчас; нет — спросим «Ход задачи». */
    current?: readonly string[];
    onClose: () => void;
    onDone: () => void | Promise<void>;
  },
) {
  const dt = useDt();
  const tiles = useMemo(
    () =>
      cycles.filter((c) => c.status !== "accepted")
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [cycles],
  );
  const [live, setLive] = useState<string[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Первый клик поставил начало отрезка — второй поставит конец.
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [reason, setReason] = useState("");
  const [serverNeedsReason, setServerNeedsReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const taskId = task?.id;
  useEffect(() => {
    if (!taskId) return;
    setReason("");
    setErr(null);
    setBusy(false);
    setAwaitingEnd(false);
    setServerNeedsReason(false);
    if (current) {
      setLive([...current]);
      return;
    }
    setLive(null);
    let alive = true;
    fetchSprintJourney(taskId).then((j) => {
      if (!alive) return;
      setLive(
        j.steps.filter((s) =>
          s.cycle.status !== "accepted" &&
          s.outcome.kind !== "moved" && s.outcome.kind !== "withdrawn"
        ).map((s) => s.cycle.id),
      );
    }).catch((e) => {
      if (alive) setErr(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [taskId, current]);

  // Начальный выбор — нынешний отрезок задачи.
  const liveKey = live?.join(",") ?? "";
  useEffect(() => {
    if (live === null) return;
    const mine = tiles.filter((c) => live.includes(c.id));
    setRange(
      mine.length > 0
        ? { from: mine[0].id, to: mine[mine.length - 1].id }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, tiles]);

  if (!task) return null;
  const idx = (id: string) => tiles.findIndex((c) => c.id === id);
  const sel = range ? tiles.slice(idx(range.from), idx(range.to) + 1) : [];
  const first = sel[0];
  const last = sel.at(-1);
  const flagId = dueCycleOf(tiles, task.due)?.id;
  const active = tiles.find((c) => c.status === "active");
  const inActive = !!active && !!live?.includes(active.id);
  const lastLive = tiles.filter((c) => live?.includes(c.id)).at(-1);

  // Правило базы: причина нужна, только если последний спринт отрезка — новый для задачи.
  const endIsNew = !!last && last.status === "draft" &&
    !live?.includes(last.id);
  const afterDue = endIsNew && !!task.due && last!.start_date > task.due;
  const extendsFromActive = endIsNew && inActive &&
    last!.end_date > (lastLive?.end_date ?? active!.end_date);
  const reasonRequired = afterDue || extendsFromActive || serverNeedsReason;

  const same = sel.length > 0 && live !== null &&
    sel.filter((c) => c.status === "draft").map((c) => c.id).join(",") ===
      tiles.filter((c) => c.status === "draft" && live.includes(c.id)).map((
        c,
      ) => c.id).join(",");
  const canSave = !!first && !!last && !same && !busy &&
    (!reasonRequired || reason.trim().length > 0);

  function click(id: string) {
    if (!awaitingEnd || !range) {
      setRange({ from: id, to: id });
      setAwaitingEnd(true);
    } else {
      const a = idx(range.from), b = idx(id);
      setRange({
        from: tiles[Math.min(a, b)].id,
        to: tiles[Math.max(a, b)].id,
      });
      setAwaitingEnd(false);
    }
  }

  async function save() {
    if (!task || !first || !last) return;
    setBusy(true);
    setErr(null);
    try {
      await setSprintTaskSpan(task.id, {
        from_cycle_id: first.id,
        to_cycle_id: last.id,
        reason: reason.trim() || null,
      });
      await onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("Нужна причина")) setServerNeedsReason(true);
      setErr(msg);
      setBusy(false);
    }
  }

  const dueText = task.due
    ? dt(
      `Срок ${fmtDayShort(task.due)}${
        flagId
          ? ` (🏁 ${cycleShort(tiles.find((c) => c.id === flagId)!.name)})`
          : ""
      } не меняется`,
      `The ${fmtDayShort(task.due)} deadline${
        flagId
          ? ` (🏁 ${cycleShort(tiles.find((c) => c.id === flagId)!.name)})`
          : ""
      } stays`,
    )
    : dt("Срока у задачи нет", "The task has no deadline");

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="span-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="span-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {dt("Спринты задачи", "Sprints of the task")}
          </DialogPrimitive.Title>
          <p className="-mt-2 truncate text-[12.5px] text-ink-mute">
            «{task.title}»
          </p>
          <p className="text-[12.5px] text-ink-soft">
            {awaitingEnd
              ? dt(
                "Теперь выберите последний спринт.",
                "Now pick the last sprint.",
              )
              : dt(
                "Выберите первый спринт, затем последний — задача ведётся во всех между ними.",
                "Pick the first sprint, then the last — the task runs through all between them.",
              )}
          </p>

          {live === null && !err
            ? (
              <p className="text-[12.5px] text-ink-mute" role="status">
                {dt("Загрузка…", "Loading…")}
              </p>
            )
            : (
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label={dt("Спринты пространства", "Sprints of the space")}
              >
                {tiles.map((c) => {
                  const on = sel.some((x) => x.id === c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      aria-pressed={on}
                      onClick={() => click(c.id)}
                      className={cn(
                        "rounded-[8px] border px-2.5 py-1 text-left text-[12.5px] font-medium",
                        on
                          ? "border-primary/50 bg-primary/12 text-primary"
                          : "border-line text-ink-soft hover:text-ink",
                        c.status === "active" &&
                          "outline-[1.5px] outline-offset-1 outline-primary",
                      )}
                    >
                      {c.id === flagId ? "🏁 " : ""}
                      {cycleShort(c.name)}
                      <span className="ml-1.5 font-mono text-[11px] opacity-70">
                        {cycleDates(c)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

          {first && last && (
            <p className="text-[13px] font-medium text-ink">
              {sel.length === 1
                ? dt(
                  `Ведём в одном спринте: ${cycleShort(first.name)}.`,
                  `One sprint: ${cycleShort(first.name)}.`,
                )
                : dt(
                  `Ведём в ${sel.length} спринтах: ${cycleShort(first.name)}–${
                    cycleShort(last.name)
                  }.`,
                  `Runs through ${sel.length} sprints: ${
                    cycleShort(first.name)
                  }–${cycleShort(last.name)}.`,
                )} {dueText}.
            </p>
          )}
          {active && first && last && first.start_date > active.start_date &&
            inActive && (
            <p className="text-[12px] text-ink-mute">
              {dt(
                "Идущий спринт план не трогает — задача в нём остаётся.",
                "The running sprint is left as is — the task stays in it.",
              )}
            </p>
          )}

          {reasonRequired && (
            <div className="flex flex-col gap-1.5 rounded-[8px] border border-pri-high/40 bg-pri-high/8 px-3 py-2">
              <span className="text-[12.5px] font-semibold text-pri-high">
                {afterDue || (serverNeedsReason && !extendsFromActive)
                  ? dt(
                    "Работа выходит за срок задачи — нужна причина.",
                    "The work runs past the deadline — a reason is required.",
                  )
                  : dt(
                    "Задача продлевается за последний спринт — нужна причина.",
                    "The task is extended past its last sprint — a reason is required.",
                  )}
              </span>
              <textarea
                autoFocus
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={dt("Причина", "Reason")}
                placeholder={dt(
                  "Например: ждём подрядчика",
                  "For example: waiting for the contractor",
                )}
                className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent-line"
              />
            </div>
          )}

          {err && <p className="text-[12.5px] text-pri-high">{err}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={PILL_BTN}
            >
              {dt("Отмена", "Cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={cn(
                PILL_BTN,
                "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              {busy ? dt("Сохраняем…", "Saving…") : dt("Сохранить", "Save")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
