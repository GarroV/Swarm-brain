"use client";
import { useState, type FormEvent } from "react";
import type { ShortLink, ShortLinkMeta } from "@/lib/api";
import { RoyIcon } from "@/components/roy/icons";

// Строка списка коротких ссылок: название, автор и время, куда ведёт, переходы.
// Править и убирать может автор или админ (can_manage считает сервер). Адрес назначения
// не правится: под ним уже разосланы СМС — нужен другой адрес, делается новая ссылка.

type Dt = (ru: string, en: string) => string;

const shortUrl = (code: string) => `${window.location.origin}/s/${code}`;

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

type Props = {
  link: ShortLink;
  dt: Dt;
  copied: boolean;
  onCopy: () => void;
  onSave: (meta: ShortLinkMeta) => Promise<boolean>;
  onArchive: () => void;
};

export function ShortLinkRow({ link: l, dt, copied, onCopy, onSave, onArchive }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(l.title ?? "");
  const [note, setNote] = useState(l.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setSaving(true);
    const ok = await onSave({ title, note });
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={save} className="mb-2 flex flex-col gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus
          aria-label={dt("Название", "Name")}
          className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 14 }} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
          aria-label={dt("Комментарий", "Comment")} placeholder={dt("Комментарий", "Comment")}
          className="resize-y rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 13 }} />
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !title.trim()}
            className="rounded-[8px] bg-ink px-3 py-1.5 font-semibold text-surface disabled:opacity-50" style={{ fontSize: 13 }}>
            {saving ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
          </button>
          <button type="button" onClick={() => { setTitle(l.title ?? ""); setNote(l.note ?? ""); setEditing(false); }}
            className="rounded-[8px] border border-line px-3 py-1.5 text-ink" style={{ fontSize: 13 }}>
            {dt("Отмена", "Cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mb-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink" style={{ fontSize: 14 }}>
            {l.title ?? dt("Без названия", "Untitled")}
          </div>
          <div className="truncate text-ink" style={{ fontSize: 13 }}>{shortUrl(l.code).replace(/^https?:\/\//, "")}</div>
          <div className="truncate text-ink-soft" style={{ fontSize: 12 }} title={l.url}>→ {l.url}</div>
        </div>
        <button type="button" onClick={onCopy}
          className="shrink-0 rounded-[8px] border border-line px-2.5 py-1.5 text-ink" style={{ fontSize: 12 }}>
          {copied ? dt("Скопировано", "Copied") : dt("Копировать", "Copy")}
        </button>
        {l.can_manage && (
          <>
            <button type="button" onClick={() => setEditing(true)} aria-label={dt("Изменить", "Edit")}
              className="shrink-0 rounded-[8px] p-1.5 text-ink-soft hover:text-ink">
              <RoyIcon name="pencil" size={15} />
            </button>
            <button type="button" onClick={onArchive} aria-label={dt("Убрать ссылку", "Remove link")}
              className="shrink-0 rounded-[8px] p-1.5 text-ink-soft hover:text-ink">
              <RoyIcon name="trash" size={15} />
            </button>
          </>
        )}
      </div>
      {l.note && <p className="mt-1.5 whitespace-pre-wrap text-ink" style={{ fontSize: 13 }}>{l.note}</p>}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-ink-soft" style={{ fontSize: 12 }}>
        <span>{l.owner_name} · {when(l.created_at)}</span>
        <span>
          {dt("Переходов", "Clicks")}: {l.clicks}
          {l.last_clicked_at && ` · ${dt("последний", "last")} ${when(l.last_clicked_at)}`}
        </span>
      </div>
    </div>
  );
}
