"use client";
// Модалка создания/правки персональной метки (списка): имя + пиктограмма + удаление.
import { useEffect, useState } from "react";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { createTaskLabel, updateTaskLabel, deleteTaskLabel, type TaskLabel } from "@/lib/api";

// Curated-набор иконок для меток (все существуют в RoyIcon).
const LABEL_ICONS: RoyIconName[] = ["tag", "task", "book", "flag", "note", "spark", "globe", "cal", "doc", "meet", "link", "home"];

type Props = { label: TaskLabel | "new"; open: boolean; onClose: () => void; onSaved: () => void };

export function LabelEditor({ label, open, onClose, onSaved }: Props) {
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-[360px] rounded-2xl border border-line bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-bold text-accent-ink" style={{ fontSize: 16 }}>{editing ? "Список" : "Новый список"}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Название (напр. Айти)"
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
            <button type="button" onClick={remove} className="text-destructive" style={{ fontSize: 13 }}>Удалить</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3.5 py-1.5 text-ink-soft" style={{ fontSize: 13 }}>Отмена</button>
            <button
              type="button"
              onClick={save}
              disabled={!name.trim() || busy}
              className="rounded-full bg-primary px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
              style={{ fontSize: 13 }}
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
