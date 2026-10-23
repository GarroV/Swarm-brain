"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { JourneyOutcome, JourneyStep, SprintJourney } from "@/types";
import { fetchSprintJourney } from "@/lib/api";
import { cycleDates, cycleShort } from "@/lib/sprintLabels";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { fmtDayShort } from "./format";
import { PILL_BTN } from "./atoms";

// «Ход задачи» (решение владельца 22.10.2026: «аналитику по задаче — где, что, когда, как»):
// сверху итог, ниже по спринтам — даты, срок на входе и выходе, комментарии за окно спринта,
// перенос с причиной, итог. Компактно, без графиков; раскладку считает сервер (buildJourney).

function useOutcomeText() {
  const dt = useDt();
  return (
    o: JourneyOutcome,
  ): { text: string; tone: "ok" | "warn" | "mute" } => {
    switch (o.kind) {
      case "done":
        return {
          text: `${dt("Сделана", "Done")} ${fmtDayShort(o.at)}${
            o.onTime === null
              ? ""
              : o.onTime
              ? dt(" — до срока", " — on time")
              : dt(" — после срока", " — past the deadline")
          }`,
          tone: o.onTime === false ? "warn" : "ok",
        };
      case "cancelled":
        return { text: dt("Отменена", "Cancelled"), tone: "mute" };
      case "moved":
        return { text: dt("Перенесена", "Moved on"), tone: "warn" };
      case "withdrawn":
        return {
          text: dt("Снята из спринта", "Removed from the sprint"),
          tone: "mute",
        };
      case "continued":
        return {
          text: dt("Продолжилась в следующем", "Continued in the next one"),
          tone: "mute",
        };
      case "inProgress":
        return { text: dt("Идёт", "In progress"), tone: "ok" };
      case "planned":
        return { text: dt("Запланирован", "Planned"), tone: "mute" };
      default:
        return {
          text: dt("Не закрыта к концу спринта", "Not closed by the end"),
          tone: "warn",
        };
    }
  };
}

function Step({ step }: { step: JourneyStep }) {
  const dt = useDt();
  const outcome = useOutcomeText()(step.outcome);
  const dueChanged = step.dueIn !== step.dueOut;
  return (
    <li className="flex flex-col gap-1 rounded-[9px] border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-[13px] text-ink" title={step.cycle.name}>
          {cycleShort(step.cycle.name)}
        </b>
        <span className="font-mono text-[11.5px] text-ink-mute">
          {cycleDates(step.cycle)}
        </span>
        <span
          className={cn(
            "ml-auto text-[12px] font-semibold",
            outcome.tone === "ok" && "text-status-done",
            outcome.tone === "warn" && "text-pri-med",
            outcome.tone === "mute" && "text-ink-mute",
          )}
        >
          {outcome.text}
        </span>
      </div>
      <div className="text-[12px] text-ink-soft">
        {dt("Срок на входе", "Deadline in")}{" "}
        <span className="tabular-nums">
          {step.dueIn ? fmtDayShort(step.dueIn) : "—"}
        </span>
        {dueChanged && (
          <>
            {" → "}
            {dt("на выходе", "out")}{" "}
            <span className="font-semibold tabular-nums text-ink">
              {step.dueOut ? fmtDayShort(step.dueOut) : "—"}
            </span>
          </>
        )}
      </div>
      {step.move && (
        <div className="text-[12px] text-pri-med">
          {dt("Перенесена", "Moved")} →{" "}
          {step.move.toName ?? dt("(спринт удалён)", "(sprint deleted)")}
          {step.move.reason
            ? <>· {dt("причина", "reason")}: «{step.move.reason}»</>
            : <>· {dt("причина не указана", "no reason given")}</>}
        </div>
      )}
      {step.planReason && (
        <div className="text-[12px] text-ink-soft">
          {dt("План после срока", "Plan past the deadline")}: «{step
            .planReason}»
        </div>
      )}
      {step.comments.length > 0 && (
        <ul className="mt-0.5 flex flex-col gap-1 border-l-2 border-line pl-2.5">
          {step.comments.map((c) => (
            <li key={c.id} className="text-[12px] text-ink-soft">
              <span className="text-ink-mute">
                {c.added_by} · {fmtDayShort(c.created_at)}
              </span>
              <div className="line-clamp-3 whitespace-pre-wrap break-words text-ink">
                {c.content}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function JourneyDialog(
  { task, onClose }: {
    /** `null` — окно закрыто. */
    task: { id: string; title: string } | null;
    onClose: () => void;
  },
) {
  const dt = useDt();
  const [data, setData] = useState<SprintJourney | "error" | null>(null);
  const taskId = task?.id;
  useEffect(() => {
    if (!taskId) return;
    setData(null);
    let alive = true;
    fetchSprintJourney(taskId).then((j) => alive && setData(j)).catch(() =>
      alive && setData("error")
    );
    return () => {
      alive = false;
    };
  }, [taskId]);
  if (!task) return null;

  const s = data && data !== "error" ? data.summary : null;
  const chips: string[] = s
    ? [
      dt(`спринтов ${s.sprints}`, `${s.sprints} sprints`),
      dt(`переносов ${s.moves}`, `${s.moves} moves`),
      dt(`апдейтов ${s.updates}`, `${s.updates} updates`),
      dt(`в работе ${s.daysInWork} дн.`, `${s.daysInWork} days in work`),
      ...(s.lateDays === null ? [] : [
        s.lateDays > 0
          ? dt(
            `отставание от первого срока ${s.lateDays} дн.`,
            `${s.lateDays} days behind the first deadline`,
          )
          : dt("в рамках первого срока", "within the first deadline"),
      ]),
    ]
    : [];

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="journey-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="journey-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {dt("Ход задачи", "Task journey")}
          </DialogPrimitive.Title>
          <p className="-mt-2 truncate text-[12.5px] text-ink-mute">
            «{task.title}»
          </p>

          {data === null && (
            <p className="text-[12.5px] text-ink-mute" role="status">
              {dt("Загрузка…", "Loading…")}
            </p>
          )}
          {data === "error" && (
            <p className="text-[12.5px] text-pri-high" role="alert">
              {dt(
                "Не удалось загрузить ход задачи",
                "Could not load the journey",
              )}
            </p>
          )}
          {s && (
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="journey-summary"
            >
              {chips.map((c) => (
                <span
                  key={c}
                  className="whitespace-nowrap rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[12px] text-ink-soft"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {data && data !== "error" && (
            data.steps.length === 0
              ? (
                <p className="rounded-[8px] border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                  {dt(
                    "Задача ни разу не стояла в спринтах.",
                    "The task has never been in a sprint.",
                  )}
                </p>
              )
              : (
                <ol className="flex flex-col gap-1.5">
                  {data.steps.map((st) => <Step key={st.cycle.id} step={st} />)}
                </ol>
              )
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={PILL_BTN}>
              {dt("Закрыть", "Close")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
