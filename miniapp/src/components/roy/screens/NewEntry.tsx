"use client";
import { useState } from "react";
import { useRoyNav, useDt } from "../nav";
import { NavHeader, SectionLabel } from "../ui";
import { createEntry } from "@/lib/api";

const NEW_ENTRY_COPY = {
  textRequired: { ru: "Введите текст", en: "Enter text" },
  saved: { ru: "Сохранено в базу", en: "Saved to the knowledge base" },
  saveError: { ru: "Не удалось сохранить", en: "Could not save" },
  title: { ru: "Новая запись", en: "New entry" },
  text: { ru: "Текст", en: "Text" },
  privateEntry: { ru: "Личная запись", en: "Private entry" },
  save: { ru: "Сохранить", en: "Save" },
} as const;

export function NewEntry() {
  const { pop, setTab, toast } = useRoyNav();
  const dt = useDt();
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim()) {
      toast(dt(NEW_ENTRY_COPY.textRequired.ru, NEW_ENTRY_COPY.textRequired.en));
      return;
    }
    setSaving(true);
    try {
      await createEntry({ content: content.trim(), is_private: isPrivate });
      toast(dt(NEW_ENTRY_COPY.saved.ru, NEW_ENTRY_COPY.saved.en));
      setTab("book");
    } catch {
      toast(dt(NEW_ENTRY_COPY.saveError.ru, NEW_ENTRY_COPY.saveError.en));
      setSaving(false);
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={dt(NEW_ENTRY_COPY.title.ru, NEW_ENTRY_COPY.title.en)} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-28 pt-1">
        <div>
          <SectionLabel>{dt(NEW_ENTRY_COPY.text.ru, NEW_ENTRY_COPY.text.en)}</SectionLabel>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            autoFocus
            placeholder="Вставь текст, заметку или транскрипт — ИИ сам сделает тезисы, тип и теги"
            className="w-full resize-none rounded-[8px] border border-line-2 bg-surface px-4 py-3 text-ink outline-none focus:border-primary"
            style={{ fontSize: 15, lineHeight: 1.5 }}
          />
        </div>
        <button type="button" onClick={() => setIsPrivate((v) => !v)} className="flex w-full items-center justify-between rounded-full border border-line bg-surface px-4 py-3.5">
          <span className="font-medium text-ink" style={{ fontSize: 14.5 }}>
            {dt(NEW_ENTRY_COPY.privateEntry.ru, NEW_ENTRY_COPY.privateEntry.en)}
          </span>
          <span className="relative inline-block transition-colors" style={{ width: 44, height: 26, borderRadius: 999, background: isPrivate ? "var(--primary)" : "var(--line-2)" }}>
            <span className="absolute top-0.5 rounded-full bg-white transition-all" style={{ width: 22, height: 22, left: isPrivate ? 20 : 2 }} />
          </span>
        </button>
        <p className="text-ink-mute" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Заголовок, тип (документ/заметка/транскрипт) и рынки определит ИИ из текста.
        </p>
      </div>
      <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={submit} disabled={saving} className="w-full rounded-full bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
          {dt(NEW_ENTRY_COPY.save.ru, NEW_ENTRY_COPY.save.en)}
        </button>
      </div>
    </div>
  );
}
