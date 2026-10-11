"use client";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDt } from "../nav";
import { Delta } from "./QualityWidgets";
import { useDialogA11y } from "./useDialogA11y";
import { useInspection } from "./useInspections";
import type { Inspection } from "@/lib/api";
import { countryFlag } from "@/lib/countries";
import { inspectionChange, inspectionTaskDraft, pctText, previousText, type TaskDraft } from "@/lib/homeInspections";

// Боковая панель проверки: итог (из строки списка — виден сразу), зоны и нарушения (GET /inspections/:id),
// ссылка на отчёт в Децимусе и кнопка «Создать задачу» — она только открывает обычное окно создания задачи
// с заполненной формой; ничего не сохраняется и никому не отправляется.

export function GradeChip({ grade }: { grade: string | null }) {
  if (!grade) return null;
  return <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-semibold text-ink-soft" style={{ fontSize: 11 }}>{grade}</span>;
}

const label = "font-semibold uppercase text-ink-mute";

export function InspectionPanel({ row, onClose, onCreateTask }: { row: Inspection; onClose: () => void; onCreateTask: (d: TaskDraft) => void }) {
  const dt = useDt();
  const en = dt("ru", "en") === "en";
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  const { data, loading, failed, retry } = useInspection(row.id);
  const change = inspectionChange(row);
  const counts = data ? Object.entries(data.inspection.counts) : [];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="insp-title" tabIndex={-1}
        className="flex h-full w-full max-w-[480px] flex-col gap-4 overflow-y-auto border-l border-line bg-card p-5 text-ink shadow-xl outline-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="insp-title" className="truncate font-semibold" style={{ fontSize: 18 }}>{row.unit.name} <span style={{ fontSize: 14 }}>{countryFlag(row.unit.cc)}</span></h2>
            <p className="font-mono text-ink-mute" style={{ fontSize: 12 }}>{row.date}{row.kind ? ` · ${row.kind}` : ""}</p>
          </div>
          <button type="button" data-autofocus onClick={onClose} aria-label={dt("Закрыть", "Close")} className="rounded-md px-2 py-0.5 text-[20px] leading-none text-ink-soft hover:bg-surface-2">×</button>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[10px] border border-line px-3 py-2.5">
          <span className="font-mono font-semibold" style={{ fontSize: 26 }}>{pctText(row.score_pct)}</span>
          <GradeChip grade={row.grade} />
          {change != null && <Delta v={change} />}
          <span className="basis-full text-ink-mute" style={{ fontSize: 12 }}>{dt("Прошлая", "Previous")}: {previousText(row, en)}</span>
        </div>

        {loading && <div className="roy-shim" style={{ height: 180, borderRadius: 10 }} />}
        {failed && (
          <p role="alert" className="rounded-[10px] border border-dashed border-line-2 px-3 py-4 text-center text-ink-mute" style={{ fontSize: 13 }}>
            {dt("Подробности не загрузились.", "Couldn't load the details.")}{" "}
            <button type="button" onClick={retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
          </p>
        )}

        {data && (
          <>
            {counts.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label={dt("Нарушения по классам", "Violations by class")}>
                {counts.map(([k, v]) => <span key={k} className="rounded-full border border-line px-2 py-0.5 text-ink-soft" style={{ fontSize: 11.5 }}>{k}: <b className="font-mono">{v}</b></span>)}
              </div>
            )}
            {data.inspection.zones.length > 0 && (
              <section>
                <h3 className={`mb-1.5 ${label}`} style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>{dt("Зоны", "Zones")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {data.inspection.zones.map((z) => (
                    <li key={z.zone} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3" style={{ fontSize: 13 }}>
                      <span className="truncate">{dt(z.title_ru ?? z.zone, z.title_en ?? z.zone)}</span>
                      <span className="font-mono font-semibold">{pctText(z.pct)}</span>
                      <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${z.pct}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className={`mb-1.5 ${label}`} style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>{dt(`Нарушения (${data.findings.length})`, `Violations (${data.findings.length})`)}</h3>
              {data.findings.length === 0
                ? <p className="text-ink-mute" style={{ fontSize: 13 }}>{dt("Нарушений нет", "No violations")}</p>
                : (
                  <ol className="flex flex-col gap-2">
                    {data.findings.map((f) => (
                      <li key={f.n} className="rounded-[10px] border border-line px-3 py-2" style={{ fontSize: 13 }}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-ink-mute">{f.n}.</span>
                          <span className="font-mono font-semibold">{f.code}</span>
                          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-soft" style={{ fontSize: 11 }}>{f.level}</span>
                          {f.repeat && <span className="rounded-md bg-[color-mix(in_srgb,var(--pri-high)_12%,transparent)] px-1.5 py-0.5 text-[var(--pri-high)]" style={{ fontSize: 11 }}>{dt("повтор", "repeat")}</span>}
                        </div>
                        {(f.title_ru || f.title_en) && <p className="mt-1 text-ink">{dt(f.title_ru ?? f.title_en ?? "", f.title_en ?? f.title_ru ?? "")}</p>}
                        {f.text && <p className="mt-0.5 text-ink-soft">{f.text}</p>}
                      </li>
                    ))}
                  </ol>
                )}
            </section>
          </>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          {row.report_url
            ? <a href={row.report_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline" style={{ fontSize: 13 }}>{dt("Отчёт в Децимусе", "Report in Decimus")} ↗</a>
            : <span />}
          <button type="button" onClick={() => onCreateTask(inspectionTaskDraft(row, data?.findings ?? null, en))}
            className="rounded-lg bg-primary px-4 py-1.5 font-medium text-primary-foreground" style={{ fontSize: 13 }}>
            {dt("Создать задачу", "Create task")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
