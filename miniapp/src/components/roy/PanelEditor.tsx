"use client";
import { useContext } from "react";
import { DetailPanelContext } from "./ui";
import { useDt } from "./nav";

// Правка длинного текста (тезисы) внутри карточки. В правой панели поле занимает её высоту,
// а «Сохранить / Отмена» прилипают к низу — правка не упирается в восемь строк и не уезжает
// за край (решение владельца 2026-09-25: «адекватно окно редактирования там же справа»).
// На мобайле — прежняя высота. ⌘/Ctrl+Enter сохраняет, Esc отменяет правку, а не закрывает
// панель: DetailPanel пропускает Esc, пока фокус внутри [data-panel-edit].

/** Высота поля в панели: экран минус шапка панели, заголовок карточки и полоса кнопок. */
const PANEL_EDIT_H = "calc(100dvh - 300px)";
const MOBILE_EDIT_MIN_H = 220;

export function PanelEditor({ value, onChange, onSave, onCancel, busy, label }: {
  value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void;
  busy?: boolean; label: string;
}) {
  const dt = useDt();
  const panel = useContext(DetailPanelContext);
  return (
    <div data-panel-edit className="mb-4 flex flex-col">
      <textarea value={value} onChange={(ev) => onChange(ev.target.value)} autoFocus aria-label={label}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") { ev.preventDefault(); onCancel(); }
          if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !busy) { ev.preventDefault(); onSave(); }
        }}
        className="w-full resize-none rounded-[8px] border border-line-2 bg-surface px-4 py-3 text-ink outline-none focus:border-primary"
        style={{ fontSize: 14, lineHeight: 1.55, height: panel ? PANEL_EDIT_H : undefined, minHeight: MOBILE_EDIT_MIN_H }} />
      <div className="sticky bottom-0 mt-2 flex items-center gap-2 bg-background py-2 dark:bg-[var(--surface)]">
        <button type="button" onClick={onSave} disabled={busy} title="⌘/Ctrl+Enter"
          className="flex-1 rounded-[8px] bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-60" style={{ fontSize: 14 }}>
          {busy ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
        </button>
        <button type="button" onClick={onCancel}
          title="Esc"
          className="rounded-[8px] border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>
          {dt("Отмена", "Cancel")}
        </button>
      </div>
    </div>
  );
}
