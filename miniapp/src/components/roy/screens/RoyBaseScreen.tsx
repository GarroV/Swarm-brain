"use client";
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { RoyHeader, NavHeader, RoyCard, TypeTag, Market, Chip, FAB } from "../ui";
import { RoyIcon } from "../icons";
import { entryTagKey, entryFacet, deriveEntryTitle, entryPreview } from "../entry";
import { fetchEntries } from "@/lib/api";
import type { Entry } from "@/types";

// Встреч здесь нет (GET /entries отдаёт только entry_type='note'; встречи — свой таб).
// Фильтры — по ФАСЕТУ заметки: заметки / ссылки / файлы.
const FILTERS = [
  { id: "all", label: "Все" },
  { id: "note", label: "Заметки" },
  { id: "link", label: "Ссылки" },
  { id: "file", label: "Файлы" },
];

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

export function RoyBaseScreen({ onBack }: { onBack?: () => void }) {
  const { push, openAnswer } = useRoyNav();
  const dt = useDt();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetchEntries()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  const items = (entries ?? []).filter((e) => filter === "all" || entryFacet(e) === filter);
  const go = (query: string) => {
    const v = query.trim();
    if (v) openAnswer(v);
  };

  return (
    <div className="relative h-full overflow-y-auto">
      {/* На мобайле экран открывается из «Ещё» (push) — нужна кнопка «Назад»; на десктопе это
          раздел (таб `book`), там прежняя шапка-заголовок. */}
      {onBack ? <NavHeader onBack={onBack} title={dt("База", "Knowledge base")} /> : <RoyHeader title={dt("База", "Knowledge base")} />}
      <div className="px-5">
        <form onSubmit={(e) => { e.preventDefault(); go(q); }}>
          <div className="flex items-center gap-2.5 rounded-[15px] border border-line-2 bg-surface px-4 py-3">
            <RoyIcon name="spark" size={18} className="shrink-0 text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Семантический поиск по базе"
              enterKeyHint="search"
              className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 15 }}
            />
          </div>
        </form>
      </div>
      <div className="flex gap-2 overflow-x-auto px-5 py-3 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>
      <div className="space-y-2.5 px-5 pb-28">
        {entries == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 88, borderRadius: 18 }} />)}
        {entries && items.length === 0 && <div className="py-10 text-center text-sm text-ink-soft">Здесь пока пусто</div>}
        {items.map((e) => (
          <button key={e.id} type="button" onClick={() => push({ view: "record", params: { id: e.id } })} className="w-full text-left transition-transform active:scale-[0.99]">
            <RoyCard className="px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <TypeTag type={entryTagKey(e)} small />
                <Market code={e.countries?.[0]} />
                {fmtDate(e.entry_date || e.created_at) && (
                  <span className="text-ink-mute" style={{ fontSize: 11 }}>
                    {fmtDate(e.entry_date || e.created_at)}
                  </span>
                )}
                {e.added_by && (
                  <span className="text-ink-mute" style={{ fontSize: 11 }}>· {e.added_by}</span>
                )}
              </div>
              <div className="mb-0.5 font-semibold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
                {deriveEntryTitle(e)}
              </div>
              {(() => {
                const preview = entryPreview(e);
                return preview ? (
                  <div className="line-clamp-2 text-ink-soft" style={{ fontSize: 13 }}>
                    {preview}
                  </div>
                ) : null;
              })()}
            </RoyCard>
          </button>
        ))}
      </div>
      <FAB onClick={() => push({ view: "newEntry" })} />
    </div>
  );
}
