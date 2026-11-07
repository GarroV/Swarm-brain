"use client";
import { useEffect, useState } from "react";
import type { Entry } from "@/types";
import { patchMeeting } from "@/lib/api";
import { useRoyNav, useDt } from "../nav";
import { RoyIcon } from "../icons";

const CONTENT_COPY = {
  content: { ru: "Содержание", en: "Content" },
  edit: { ru: "Редактировать", en: "Edit" },
  saving: { ru: "Сохранение…", en: "Saving…" },
  save: { ru: "Сохранить", en: "Save" },
  cancel: { ru: "Отмена", en: "Cancel" },
  empty: { ru: "Содержания нет.", en: "No content." },
} as const;

// ── Inline-редактор содержания (entry) ────────────────────────────────────────

export function ContentEditor({
  entry,
  onSaved,
}: {
  entry: Entry;
  onSaved: (updated: Entry) => void;
}) {
  const { toast } = useRoyNav();
  const dt = useDt();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);

  // Если выбрали другую запись — сбросить локальное состояние редактора.
  useEffect(() => {
    setEditing(false);
    setDraft(entry.content);
    setSaving(false);
  }, [entry.id, entry.content]);

  const startEdit = () => {
    setDraft(entry.content);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(entry.content);
    setEditing(false);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await patchMeeting(entry.id, { content: draft });
      onSaved(updated);
      setEditing(false);
    } catch {
      toast("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const hasContent = Boolean(entry.content?.trim());

  return (
    <div>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          {dt(CONTENT_COPY.content.ru, CONTENT_COPY.content.en)}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 bg-transparent border-0 font-semibold text-ink-soft transition-opacity hover:opacity-70"
            style={{ fontSize: 11.5 }}
          >
            <RoyIcon name="pencil" size={13} strokeWidth={1.9} />
            {dt(CONTENT_COPY.edit.ru, CONTENT_COPY.edit.en)}
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="w-full resize-y rounded-[8px] border border-line bg-surface text-ink leading-relaxed outline-none focus:border-[var(--accent-ink)] disabled:opacity-50"
            style={{ fontSize: 13, padding: "10px 12px", minHeight: 220 }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex items-center gap-1.5 rounded-full border-0 font-semibold transition-opacity disabled:opacity-50"
              style={{ padding: "8px 14px", fontSize: 13, background: "var(--accent-ink)", color: "var(--card)" }}
            >
              <RoyIcon name="check" size={14} strokeWidth={2.1} />
              {saving ? dt(CONTENT_COPY.saving.ru, CONTENT_COPY.saving.en) : dt(CONTENT_COPY.save.ru, CONTENT_COPY.save.en)}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancel}
              className="rounded-full border border-line bg-surface font-semibold text-ink-soft transition-opacity disabled:opacity-50"
              style={{ padding: "7px 14px", fontSize: 13 }}
            >
              {dt(CONTENT_COPY.cancel.ru, CONTENT_COPY.cancel.en)}
            </button>
          </div>
        </div>
      ) : hasContent ? (
        <p className="text-ink-soft leading-relaxed whitespace-pre-wrap" style={{ fontSize: 13 }}>
          {entry.content.slice(0, 800)}{entry.content.length > 800 ? "…" : ""}
        </p>
      ) : (
        <p className="text-ink-mute" style={{ fontSize: 13 }}>{dt(CONTENT_COPY.empty.ru, CONTENT_COPY.empty.en)}</p>
      )}
    </div>
  );
}
