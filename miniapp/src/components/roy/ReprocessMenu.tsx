"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDt } from "./nav";
import { RoyIcon } from "./icons";

// Пресеты уточнения к переработке тезисов. note уходит в промпт модели как приоритетная
// инструкция (не пользователю) — поэтому по-русски в обеих локалях; label — двуязычный.
const PRESETS: Array<{ ru: string; en: string; note: string }> = [
  { ru: "Короче", en: "Shorter", note: "Сделай тезисы короче: суть каждого вопроса — 1–2 ёмких пункта, лишние детали убери." },
  { ru: "Подробнее", en: "More detail", note: "Сделай подробнее: больше конкретики и деталей по каждому вопросу." },
  { ru: "Акцент на решениях", en: "Focus on decisions", note: "Сделай акцент на решениях и изменениях — что реально поменялось, о чём договорились." },
];

const DEFAULT_BUTTON_CLS =
  "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50";

/** Кнопка «Переобработать» + меню «Что поменять в тезисах?» (общая для вычитки, опубликованной
 *  встречи и админского ревью). onPick(undefined) — «Просто пересобрать», иначе — пожелание. */
export function ReprocessMenu({
  busy,
  disabled,
  onPick,
  buttonClassName = DEFAULT_BUTTON_CLS,
  buttonStyle = { padding: "5px 11px", fontSize: 12 },
  iconSize = 13,
}: {
  busy: boolean;
  disabled?: boolean;
  onPick: (note?: string) => void;
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
  iconSize?: number;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Закрытие кликом по свободному месту и Escape (паттерн как в CountryPopover/QuickPickPopover).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (n?: string) => {
    setOpen(false);
    setNote("");
    onPick(n);
  };

  const itemCls = "w-full rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-2";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy || disabled}
        title={dt("Переобработать тезисы (можно уточнить, что изменить)", "Reprocess the summary (you can say what to change)")}
        className={buttonClassName}
        style={buttonStyle}
      >
        <span className="inline-flex items-center gap-1.5">
          <RoyIcon name="spark" size={iconSize} strokeWidth={1.9} /> {busy ? dt("Обрабатываю…", "Processing…") : dt("Переобработать", "Reprocess")}
        </span>
      </button>
      {open && !busy && (
        <div className="absolute right-0 z-20 mt-1 w-64 space-y-1 rounded-[8px] border border-line bg-card p-2 text-left shadow-lg dark:backdrop-blur-lg">
          <p className="px-1 pb-1 text-[11px] text-ink-soft">{dt("Что поменять в тезисах?", "What should change in the summary?")}</p>
          <button type="button" onClick={() => pick()} className={itemCls}>{dt("Просто пересобрать", "Just rebuild")}</button>
          {PRESETS.map((p) => (
            <button key={p.ru} type="button" onClick={() => pick(p.note)} className={itemCls}>{dt(p.ru, p.en)}</button>
          ))}
          <div className="border-t border-line pt-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) pick(note.trim()); }}
              placeholder={dt("Своё пожелание, Enter", "Your own request, Enter")}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}
