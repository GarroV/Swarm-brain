"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, TypeTag, Market, SectionLabel, TezisyBlocks } from "../ui";
import { RoyIcon } from "../icons";
import { entryTagKey, deriveEntryTitle, isSearchIndexSummary } from "../entry";
import { fetchEntry, createTask } from "@/lib/api";
import type { Entry } from "@/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// Человекочитаемый источник записи (обязательная пометка провенанса).
const SOURCE_LABEL: Record<string, string> = {
  granola: "Granola", read_ai: "Read.ai", "desktop-agent": "Рекордер", "swarm-recorder": "Рекордер",
  telegram: "Бот (Telegram)", link: "Ссылка", note: "Заметка", pdf: "PDF", image: "Изображение",
  claude_desktop: "Claude Desktop", manual: "Вручную", digest: "Дайджест",
};
function sourceLabel(s: string): string { return SOURCE_LABEL[s] ?? (s || "—"); }
// Кто добавил: импортёр (резолв с сервера) → иначе username (added_by), если это не системный источник.
function addedByName(e: Entry): string {
  if (e.importer_name) return e.importer_name;
  const ab = e.added_by || "";
  if (["granola", "read_ai", "claude_desktop", "desktop-agent", "swarm-recorder"].includes(ab)) return "";
  return ab;
}

// Содержимое записи + обязательная строка источника. Переиспользуется push-экраном RecordDetail
// и контекстным окном ответа (AnswerModal).
export function RecordBody({ entry: e }: { entry: Entry }) {
  const who = addedByName(e);
  const date = fmtDate(e.entry_date || e.created_at);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 pt-1">
        <TypeTag type={entryTagKey(e)} />
        <Market code={e.countries?.[0]} />
        {date && <span className="text-ink-mute" style={{ fontSize: 12 }}>{date}</span>}
      </div>
      <h1 className="mb-2 font-bold text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
        {deriveEntryTitle(e)}
      </h1>
      {/* Источник / провенанс — у каждой записи. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft" style={{ fontSize: 12 }}>
        <span className="inline-flex items-center gap-1.5">
          <RoyIcon name="link" size={13} className="text-ink-mute" />
          Источник: <span className="font-semibold text-ink">{sourceLabel(e.source)}</span>
        </span>
        {who && <span>· добавил: <span className="font-semibold text-ink">{who}</span></span>}
      </div>
      {e.summary && !isSearchIndexSummary(e) && (
        <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 16 }}>
          <div className="mb-1.5 font-mono font-semibold uppercase text-accent-ink" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>Кратко от ИИ</div>
          <TezisyBlocks text={e.summary} />
        </div>
      )}
      <SectionLabel>Текст</SectionLabel>
      <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.65 }}>{e.content}</p>
    </>
  );
}

export function RecordDetail({ id }: { id: string }) {
  const { pop, setTab, toast } = useRoyNav();
  const [e, setE] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreateTask = async () => {
    if (!e || creating) return;
    setCreating(true);
    try {
      await createTask({ title: deriveEntryTitle(e), country: e.countries?.[0] ?? null });
      toast("Задача создана");
      setTab("task");
    } catch {
      toast("Не удалось создать задачу");
      setCreating(false);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchEntry(id).then((x) => alive && setE(x)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Запись" />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {err && <div className="py-8 text-center text-sm text-ink-soft">Не удалось загрузить запись.</div>}
        {e && <RecordBody entry={e} />}
      </div>
      <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button
          type="button"
          onClick={handleCreateTask}
          disabled={!e || creating}
          className="w-full rounded-[14px] bg-primary py-3.5 font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-60"
          style={{ fontSize: 15 }}
        >
          {creating ? "Создаём…" : "В задачу"}
        </button>
      </div>
    </div>
  );
}
