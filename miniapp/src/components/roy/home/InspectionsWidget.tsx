"use client";
import { useMemo, useState } from "react";
import { useDt } from "../nav";
import { Delta } from "./QualityWidgets";
import { GradeChip, InspectionPanel } from "./InspectionPanel";
import { useInspections } from "./useInspections";
import type { Inspection } from "@/lib/api";
import { countryFlag } from "@/lib/countries";
import {
  INSPECTIONS_SHOWN, INSPECTIONS_SHOWN_MAX, inspectionChange, latestInspections, pctText, type TaskDraft,
} from "@/lib/homeInspections";

// «Проверки»: последние подтверждённые проверки стандартов по странам подборки — пиццерия, дата, балл,
// класс, движение к прошлой проверке. Клик по строке — панель с зонами и нарушениями. Источник — Децимус
// (GET /inspections); задача из проверки создаётся только кнопкой в панели.

const card = "rounded-[12px] border border-line bg-surface";
const note = "rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute";

export function InspectionsWidget({ codes, onCreateTask }: { codes: string[]; onCreateTask: (draft: TaskDraft) => void }) {
  const dt = useDt();
  const { data, loading, failed, retry } = useInspections();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Inspection | null>(null);
  const rows = useMemo(() => (data ? latestInspections(data.inspections, codes) : []), [data, codes]);

  if (loading) return <div className="roy-shim" style={{ height: 220, borderRadius: 12 }} />;
  if (failed || !data) {
    return (
      <div className={note} style={{ fontSize: 13 }}>
        {dt("Проверки не загрузились.", "Couldn't load inspections.")}{" "}
        <button type="button" onClick={retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  if (!rows.length) {
    return <div className={note} style={{ fontSize: 13 }}>{dt("За последние 90 дней проверок по этим странам нет", "No inspections for these countries in the last 90 days")}</div>;
  }
  const shown = all ? rows.slice(0, INSPECTIONS_SHOWN_MAX) : rows.slice(0, INSPECTIONS_SHOWN);
  return (
    <div className={card}>
      <ul>
        {shown.map((r, i) => (
          <li key={r.id} className={i ? "border-t border-line" : ""}>
            <button type="button" onClick={() => setOpen(r)} aria-haspopup="dialog"
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink" style={{ fontSize: 13 }}>{r.unit.name} <span className="text-ink-mute" style={{ fontSize: 11 }}>{countryFlag(r.unit.cc)}</span></span>
                <span className="block font-mono text-ink-mute" style={{ fontSize: 11 }}>{r.date}</span>
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-mono font-semibold text-ink" style={{ fontSize: 13 }}>{pctText(r.score_pct)}</span>
                <GradeChip grade={r.grade} />
              </span>
              <span className="w-[56px] whitespace-nowrap text-right">
                {inspectionChange(r) == null
                  ? <span className="text-ink-mute" style={{ fontSize: 11 }} title={dt("Прошлой проверки нет", "No previous inspection")}>—</span>
                  : <Delta v={inspectionChange(r)} small />}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > INSPECTIONS_SHOWN && (
        <div className="border-t border-line px-3 py-2 text-center">
          <button type="button" onClick={() => setAll((v) => !v)} className="font-semibold text-primary hover:underline" style={{ fontSize: 12.5 }}>
            {all ? dt("Свернуть", "Show less") : dt(`Показать ещё (${Math.min(rows.length, INSPECTIONS_SHOWN_MAX) - INSPECTIONS_SHOWN})`, `Show more (${Math.min(rows.length, INSPECTIONS_SHOWN_MAX) - INSPECTIONS_SHOWN})`)}
          </button>
        </div>
      )}
      {data.truncated && <div className="border-t border-line px-3 py-2 text-center text-ink-mute" style={{ fontSize: 11.5 }}>{dt("Децимус отдал не все проверки окна — показаны последние", "Decimus returned only part of the window — showing the latest")}</div>}
      {open && <InspectionPanel row={open} onClose={() => setOpen(null)} onCreateTask={(d) => { setOpen(null); onCreateTask(d); }} />}
    </div>
  );
}
