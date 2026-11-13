"use client";
// Модалка создания/правки персональной метки (списка): имя + пиктограмма + удаление.
import { useEffect, useState } from "react";
import { useDt } from "@/components/roy/nav";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { createTaskLabel, updateTaskLabel, deleteTaskLabel, type TaskLabel } from "@/lib/api";

// Curated-набор иконок для меток (все существуют в RoyIcon).
const LABEL_ICONS: RoyIconName[] = ["tag", "task", "book", "flag", "note", "spark", "globe", "cal", "doc", "meet", "link", "home"];

const LABEL_EDITOR_COPY = {
  list: { ru: "Список", en: "List" },
  newList: { ru: "Новый список", en: "New list" },
  namePlaceholder: { ru: "Название (напр. Айти)", en: "Name (e.g. IT)" },
  delete: { ru: "Удалить", en: "Delete" },
  cancel: { ru: "Отмена", en: "Cancel" },
  save: { ru: "Сохранить", en: "Save" },
} as const;

type Props = { label: TaskLabel | "new"; open: boolean; onClose: () => void; onSaved: () => void };

export function LabelEditor({ label, open, onClose, onSaved }: Props) {
  const dt = useDt();
  const editing = label !== "new" ? label : null;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<RoyIconName>("tag");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setIcon(((editing?.icon as RoyIconName) || "tag"));
  }, [open, editing]);

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (editing) await updateTaskLabel(editing.id, { name: name.trim(), icon });
      else await createTaskLabel({ name: name.trim(), icon });
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try { await deleteTaskLabel(editing.id); onSaved(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--scrim-faint)] p-4" onClick={onClose}>
      <div className="w-full max-w-[360px] rounded-2xl border border-line bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-bold text-accent-ink" style={{ fontSize: 16 }}>{editing ? dt(LABEL_EDITOR_COPY.list.ru, LABEL_EDITOR_COPY.list.en) : dt(LABEL_EDITOR_COPY.newList.ru, LABEL_EDITOR_COPY.newList.en)}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder={dt(LABEL_EDITOR_COPY.namePlaceholder.ru, LABEL_EDITOR_COPY.namePlaceholder.en)}
          className="mb-3 w-full rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-mute"
          style={{ fontSize: 14 }}
        />
        <div className="mb-4 grid grid-cols-6 gap-1.5">
          {LABEL_ICONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setIcon(n)}
              className={`flex aspect-square items-center justify-center rounded-[9px] border transition-colors ${icon === n ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}
            >
              <RoyIcon name={n} size={16} strokeWidth={1.9} />
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          {editing ? (
            <button type="button" onClick={remove} className="text-destructive" style={{ fontSize: 13 }}>{dt(LABEL_EDITOR_COPY.delete.ru, LABEL_EDITOR_COPY.delete.en)}</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3.5 py-1.5 text-ink-soft" style={{ fontSize: 13 }}>{dt(LABEL_EDITOR_COPY.cancel.ru, LABEL_EDITOR_COPY.cancel.en)}</button>
            <button
              type="button"
              onClick={save}
              disabled={!name.trim() || busy}
              className="rounded-full bg-primary px-3.5 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
              style={{ fontSize: 13 }}
            >
              {dt(LABEL_EDITOR_COPY.save.ru, LABEL_EDITOR_COPY.save.en)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
