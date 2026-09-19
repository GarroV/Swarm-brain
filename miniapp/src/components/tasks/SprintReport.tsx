"use client";
import type { SprintCycle } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Отчёт принятого спринта (этап 4, issue #267). Ничего не считает: `stats` посчитаны ОДИН раз
// на приёмке чистой функцией `computeSprintStats` и лежат в строке спринта — переоткрытие задачи
// потом архив не меняет. Поэтому здесь только рисование, и цифры отчёта не «уплывают» со временем.

function fmtDay(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="ml-auto text-sm font-semibold text-ink">{value}</span>
      {hint && <span className="text-[11px] text-ink-soft/70">{hint}</span>}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; done: number; total: number }[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const percent = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
        return (
          <div key={r.label}>
            <div className="flex items-baseline gap-2">
              <span className="truncate text-xs text-ink">{r.label}</span>
              <span className="ml-auto text-[11px] text-ink-soft">{r.done}/{r.total}</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SprintReport({ cycle }: { cycle: SprintCycle }) {
  const dt = useDt();
  const s = cycle.stats;

  return (
    <div className="flex flex-col min-h-0 w-72 shrink-0 rounded-2xl border border-line bg-surface/40 dark:backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <RoyIcon name="doc" size={14} strokeWidth={1.9} />
        <span className="text-sm font-bold text-ink">{dt("Итоги спринта", "Sprint results")}</span>
      </div>

      {!s ? (
        // Спринт принят до появления расчёта итогов — честнее сказать, чем показать нули.
        <p className="p-3 text-xs text-ink-soft/80">
          {dt("Итоги этого спринта не считались — он принят до появления отчёта.",
            "No results were computed for this sprint — it was accepted before the report existed.")}
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold leading-none text-ink">{s.planPercent}%</span>
              <span className="pb-0.5 text-xs text-ink-soft">
                {dt(`план ${s.planDone} из ${s.plan}`, `plan ${s.planDone} of ${s.plan}`)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary" style={{ width: `${s.planPercent}%` }} />
            </div>
          </div>

          <div className="space-y-1 border-t border-line pt-2">
            <Row label={dt("Сверх плана", "Extra")} value={`${s.extraDone}/${s.extra}`}
              hint={dt("из добавленных по ходу", "of those added mid-sprint")} />
            <Row label={dt("Перенесено", "Carried over")} value={String(s.carried)}
              hint={dt("в следующий спринт", "to the next sprint")} />
            <Row label={dt("Без исполнителя", "Unassigned")} value={String(s.unassigned)} />
          </div>

          {s.byPerson.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft/80">
                {dt("Кто сколько закрыл", "Closed by person")}
              </p>
              <Bars rows={s.byPerson.map((r) => ({ label: r.name, done: r.done, total: r.plan }))} />
            </div>
          )}

          {s.byProject.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft/80">
                {dt("По проектам", "By project")}
              </p>
              <Bars rows={s.byProject.map((r) => ({
                label: r.name ?? dt("Без проекта", "No project"), done: r.done, total: r.total,
              }))} />
            </div>
          )}

          {s.byDay.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft/80">
                {dt("Закрытия по дням", "Closed per day")}
              </p>
              {/* Столбики нормируются по самому урожайному дню — иначе на 1-2 закрытиях в день
                  график выглядел бы пустым и ничего не показывал. */}
              <div className="flex items-end gap-1 h-14">
                {s.byDay.map((d) => {
                  const max = Math.max(...s.byDay.map((x) => x.done), 1);
                  return (
                    <div key={d.day} className="h-full flex-1 flex flex-col justify-end items-center gap-1" title={`${fmtDay(d.day)}: ${d.done}`}>
                      <div className="w-full rounded-sm bg-primary/70" style={{ height: `${Math.max((d.done / max) * 100, 4)}%` }} />
                      <span className="text-[9px] leading-none text-ink-soft/70">{new Date(d.day).getDate() || ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cycle.summary && (
            <div className="border-t border-line pt-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft/80">
                {dt("Итог словами", "Summary")}
              </p>
              <p className="text-xs leading-relaxed text-ink-soft">{cycle.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
