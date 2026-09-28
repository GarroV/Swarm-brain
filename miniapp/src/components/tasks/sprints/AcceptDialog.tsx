"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycleItem } from "@/types";
import { Button } from "@/components/ui/button";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { CarryBadge } from "./atoms";

// Окно приёмки. Отдельным окном, а не подтверждением в одну строку, ради единственной вещи:
// причину переноса можно вписать ЗДЕСЬ, при автоматическом переносе (D011). Обязательной её
// не делаем — обязательная причина заставляет писать «нет времени» ради кнопки, и таблица
// причин наполняется мусором; необязательная наполняет её тем, что человек и правда знал.
//
// `carried_manual` у таких хвостов остаётся `false`: причина есть, но перенос всё равно
// автоматический — иначе отчёт назвал бы решением то, что решил сам сервер.

export interface AcceptSubmit {
  summary: string | null;
  /** task_id → причина. Только изменённые: пустое поле ничего не перезаписывает. */
  reasons: Record<string, string>;
}

export function AcceptDialog(
  { open, cycleName, carrying, busy, onCancel, onAccept }: {
    open: boolean;
    cycleName: string;
    carrying: SprintCycleItem[];
    busy: boolean;
    onCancel: () => void;
    onAccept: (input: AcceptSubmit) => void;
  },
) {
  const dt = useDt();
  const [summary, setSummary] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Свежий состав хвостов без участия в зависимостях эффекта (см. ниже, почему это важно).
  const carryingRef = useRef(carrying);
  carryingRef.current = carrying;

  // Каждое открытие — чистое окно: недописанная причина прошлой приёмки не должна
  // всплыть в следующей и уехать в отчёт как объяснение другого спринта.
  //
  // ⚠️ Зависимость ТОЛЬКО от `open`. С `carrying` в списке зависимостей окно уходило в
  // бесконечную перерисовку: список хвостов собирается фильтром на каждый рендер, то есть
  // это каждый раз НОВЫЙ массив, эффект пишет состояние, состояние даёт новый рендер, и так
  // по кругу («Maximum update depth exceeded» — поймано живым прогоном 19.09.2026). Свежие
  // причины читаются из `carrying` в момент открытия и этого достаточно: пока окно открыто,
  // состав уже не меняется.
  useEffect(() => {
    if (!open) return;
    setSummary("");
    setReasons(
      Object.fromEntries(
        carryingRef.current
          .filter((i) => i.task_id && i.carry_reason)
          .map((i) => [i.task_id as string, i.carry_reason as string]),
      ),
    );
  }, [open]);

  const submit = () => {
    const filled = Object.fromEntries(
      Object.entries(reasons).filter(([, v]) => v.trim() !== "").map((
        [k, v],
      ) => [k, v.trim()]),
    );
    onAccept({ summary: summary.trim() || null, reasons: filled });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="accept-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <div className="flex items-start gap-3.5">
            <span
              className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"
              aria-hidden
            >
              <RoyIcon name="check" size={22} strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title
                id="accept-title"
                className="font-heading text-[17px] leading-snug font-bold text-ink"
              >
                {dt(`Принять «${cycleName}»?`, `Accept “${cycleName}”?`)}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                {dt(
                  "Состав замрёт слепком, итоги посчитаются один раз. Отменить приёмку нельзя.",
                  "The composition freezes as a snapshot and the results are computed once. Accepting cannot be undone.",
                )}
              </DialogPrimitive.Description>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
            {carrying.length === 0
              ? (
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
                  {dt(
                    "Незакрытых задач нет — переносить нечего, следующий спринт создастся пустым.",
                    "Nothing is left unfinished — there is nothing to carry over, and the next sprint starts empty.",
                  )}
                </p>
              )
              : (
                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-ink">
                    {dt(
                      `Уедут в следующий спринт: ${carrying.length}`,
                      `Moving to the next sprint: ${carrying.length}`,
                    )}
                  </p>
                  <p className="text-[11.5px] text-ink-soft">
                    {dt(
                      "Следующий спринт создастся сам, встык. Причина — по желанию: она нужна, чтобы через месяц было видно, почему задача висит.",
                      "The next sprint is created automatically, right after this one. A reason is optional — it is what makes a long-hanging task explainable a month later.",
                    )}
                  </p>
                  <ul className="space-y-1.5">
                    {carrying.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-xl border border-line bg-surface/40 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                            {item.hidden
                              ? dt("Приватная задача", "Private task")
                              : item.title}
                          </span>
                          <CarryBadge count={item.carry_count} />
                        </div>
                        {item.task_id && !item.hidden && (
                          <input
                            value={reasons[item.task_id] ?? ""}
                            onChange={(e) =>
                              setReasons((prev) => ({
                                ...prev,
                                [item.task_id as string]: e.target.value,
                              }))}
                            placeholder={dt(
                              "почему переносится (необязательно)",
                              "why it is carried over (optional)",
                            )}
                            className="mt-1.5 w-full rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-primary/50"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            <div>
              <label className="text-[13px] font-semibold text-ink">
                {dt("Итоги спринта", "Sprint summary")}
                <span className="ml-1 text-[11px] font-normal text-ink-soft">
                  {dt("необязательно", "optional")}
                </span>
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
                placeholder={dt(
                  "что получилось, что нет",
                  "what worked and what did not",
                )}
                className="mt-1 w-full resize-y rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              variant="outline"
              size="lg"
              className="h-11 rounded-[8px] text-[15px]"
              disabled={busy}
              onClick={onCancel}
            >
              {dt("Отмена", "Cancel")}
            </Button>
            <Button
              size="lg"
              className="h-11 rounded-[8px] text-[15px] font-semibold"
              disabled={busy}
              onClick={submit}
            >
              {busy
                ? dt("Приёмка…", "Accepting…")
                : dt("Принять спринт", "Accept sprint")}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
