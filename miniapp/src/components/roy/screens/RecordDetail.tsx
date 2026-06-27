"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, TypeTag, Market, SectionLabel, TezisyBlocks } from "../ui";
import { entryTagKey, deriveEntryTitle, isSearchIndexSummary } from "../entry";
import { fetchEntry, createTask } from "@/lib/api";
import type { Entry } from "@/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
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
      const title = deriveEntryTitle(e);
      await createTask({
        title,
        country: e.countries?.[0] ?? null,
      });
      toast("Задача создана");
      setTab("task");
    } catch {
      toast("Не удалось создать задачу");
      setCreating(false);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchEntry(id)
      .then((x) => alive && setE(x))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Запись" />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {err && <div className="py-8 text-center text-sm text-ink-soft">Не удалось загрузить запись.</div>}
        {e && (
          <>
            <div className="mb-2 flex items-center gap-2 pt-1">
              <TypeTag type={entryTagKey(e)} />
              <Market code={e.countries?.[0]} />
              {fmtDate(e.entry_date || e.created_at) && (
                <span className="text-ink-mute" style={{ fontSize: 12 }}>
                  {fmtDate(e.entry_date || e.created_at)}
                </span>
              )}
            </div>
            <h1 className="mb-3 font-bold text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              {deriveEntryTitle(e)}
            </h1>
            {e.summary && !isSearchIndexSummary(e) && (
              <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 16 }}>
                <div className="mb-1.5 font-bold uppercase text-accent-ink" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
                  Кратко от ИИ
                </div>
                <TezisyBlocks text={e.summary} />
              </div>
            )}
            <SectionLabel>Текст</SectionLabel>
            <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
              {e.content}
            </p>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-line bg-background px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
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
