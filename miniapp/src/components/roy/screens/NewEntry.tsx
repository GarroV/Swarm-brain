"use client";
import { useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, SectionLabel } from "../ui";
import { createEntry } from "@/lib/api";

export function NewEntry() {
  const { pop, setTab, toast } = useRoyNav();
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim()) {
      toast("Введите текст");
      return;
    }
    setSaving(true);
    try {
      await createEntry({ content: content.trim(), is_private: isPrivate });
      toast("Сохранено в базу");
      setTab("book");
    } catch {
      toast("Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Новая запись" />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-28 pt-1">
        <div>
          <SectionLabel>Текст</SectionLabel>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            autoFocus
            placeholder="Вставь текст, заметку или транскрипт — ИИ сам сделает тезисы, тип и теги"
            className="w-full resize-none rounded-[18px] border border-line-2 bg-surface px-4 py-3 text-ink outline-none focus:border-primary"
            style={{ fontSize: 15, lineHeight: 1.5 }}
          />
        </div>
        <button type="button" onClick={() => setIsPrivate((v) => !v)} className="flex w-full items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3.5">
          <span className="font-medium text-ink" style={{ fontSize: 14.5 }}>
            Личная запись
          </span>
          <span className="relative inline-block transition-colors" style={{ width: 44, height: 26, borderRadius: 999, background: isPrivate ? "var(--primary)" : "var(--line-2)" }}>
            <span className="absolute top-0.5 rounded-full bg-white transition-all" style={{ width: 22, height: 22, left: isPrivate ? 20 : 2 }} />
          </span>
        </button>
        <p className="text-ink-mute" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Заголовок, тип (документ/заметка/транскрипт) и рынки определит ИИ из текста.
        </p>
      </div>
      <div className="shrink-0 border-t border-line bg-background px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={submit} disabled={saving} className="w-full rounded-[14px] bg-primary py-3.5 font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
          Сохранить
        </button>
      </div>
    </div>
  );
}
