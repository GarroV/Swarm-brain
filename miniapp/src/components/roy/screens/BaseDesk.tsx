"use client";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Entry } from "@/types";
import { fetchConfig, fetchEntriesWithTotal } from "@/lib/api";
import { countryCode, countryName } from "@/lib/countries";
import { Menu, ToolbarButton, type MenuItem } from "@/components/tasks/table/Menu";
import { useDt, useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { saveRecent } from "./SearchScreen";
import { deriveEntryTitle, entryFacet, entryImporterName, entryPreview } from "../entry";

// «База» десктопа по стенду (docs/redesign/stand/js/screens-base.js): вкладки видов записи,
// строка фильтров, таблица Запись · Вид · Рынок · Автор · Добавлена. Виды — те, что есть в
// данных (GET /entries отдаёт только заметки; встречи — свой раздел): заметки, ссылки, файлы.
// Поле поиска фильтрует список по названию на лету, Enter — ответ по базе (семантический поиск,
// как было на прежнем экране).

type Facet = "all" | "note" | "link" | "file";
const FACETS: [Facet, string, string][] = [
  ["all", "Все записи", "All records"], ["note", "Заметки", "Notes"], ["link", "Ссылки", "Links"], ["file", "Файлы", "Files"],
];
const FACET_LABEL: Record<Exclude<Facet, "all">, [string, string]> = {
  note: ["Заметка", "Note"], link: ["Ссылка", "Link"], file: ["Файл", "File"],
};
const COLS = "minmax(0,1fr) 96px 96px minmax(120px,16%) 88px";

export function BaseDesk() {
  const dt = useDt();
  const { push, openAnswer, me } = useRoyNav();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [markets, setMarkets] = useState<string[]>([]);
  const [facet, setFacet] = useState<Facet>("all");
  const [country, setCountry] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetchEntriesWithTotal()
      .then(({ rows, total }) => { setEntries(rows); setTotal(total); })
      .catch((e) => { console.error("[BaseDesk] entries", e); setFailed(true); setEntries([]); });
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => setMarkets([]));
  }, []);

  const all = entries ?? [];
  const counts = useMemo(() => {
    const c: Record<Facet, number> = { all: all.length, note: 0, link: 0, file: 0 };
    for (const e of all) c[entryFacet(e)]++;
    return c;
  }, [all]);

  const needle = q.trim().toLowerCase();
  const rows = all.filter((e) =>
    (facet === "all" || entryFacet(e) === facet) &&
    (country == null || (e.countries ?? []).map(countryCode).includes(countryCode(country))) &&
    (!mineOnly || (me?.telegram_id != null && e.owner_id === me.telegram_id)) &&
    (!needle || deriveEntryTitle(e).toLowerCase().includes(needle) || entryPreview(e).toLowerCase().includes(needle)));

  const ask = () => {
    const v = q.trim();
    if (!v) return;
    saveRecent(v);
    openAnswer(v);
  };

  const countryItems: MenuItem[] = [
    { key: "all", label: dt("все", "all"), on: country == null, action: true, onPick: () => setCountry(null) },
    ...markets.map((c) => ({ key: c, label: `${countryCode(c)} · ${countryName(c)}`, on: country === c, action: true, onPick: () => setCountry(c) })),
  ];
  const loading = entries == null;
  const truncated = total != null && all.length < total;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div role="tablist" className="flex shrink-0 items-end gap-5 overflow-x-auto border-b border-line px-5" style={{ height: 40 }}>
        {FACETS.map(([id, ru, en]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={facet === id}
            onClick={() => setFacet(id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 font-medium transition-colors",
              facet === id ? "border-primary font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink",
            )}
            style={{ fontSize: 13 }}
          >
            {dt(ru, en)}
            {!loading && <span className="text-ink-mute" style={{ fontSize: 11 }}>{counts[id]}</span>}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2">
        {markets.length > 0 && (
          <Menu label={`${dt("Страна", "Country")}: ${country ? countryCode(country) : dt("все", "all")}`} on={country != null} items={countryItems} />
        )}
        <ToolbarButton on={mineOnly} onClick={() => setMineOnly((v) => !v)}>{dt("Только мои", "Mine only")}</ToolbarButton>
        <form role="search" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <label className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line-2 bg-surface px-2.5 text-ink-mute focus-within:border-primary"
            title={dt("Enter — ответ по базе", "Enter — answer from the base")}>
            <RoyIcon name="spark" size={13} className="text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={dt("Поиск по базе · Enter — ответ", "Search the base · Enter to ask")}
              enterKeyHint="search"
              className="w-[230px] bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 12.5 }}
            />
          </label>
        </form>
        <span className="ml-auto whitespace-nowrap text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Записей", "Records")} <b className="text-ink">{rows.length}</b> {dt("из", "of")} {total ?? all.length}
        </span>
        <button
          type="button"
          onClick={() => push({ view: "newEntry" })}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-primary px-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          style={{ fontSize: 12.5 }}
        >
          <RoyIcon name="plus" size={14} strokeWidth={2.2} />
          {dt("Запись", "Record")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Честный признак усечения (#112): приехавший кусок не выдаём за весь набор. */}
        {truncated && (
          <p className="pb-2 text-ink-mute" style={{ fontSize: 12 }}>
            {dt(`Загружены ${all.length} из ${total} — поиском по базе найдётся и остальное`,
              `Loaded ${all.length} of ${total} — search the base to reach the rest`)}
          </p>
        )}
        {loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim mb-1.5" style={{ height: 46, borderRadius: 8 }} />)}
        {!loading && failed && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center text-ink-soft" style={{ fontSize: 13 }}>
            {dt("База не загрузилась — обновите страницу", "The base failed to load — reload the page")}
          </div>
        )}
        {!loading && !failed && rows.length === 0 && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center">
            <div className="font-medium text-ink" style={{ fontSize: 13.5 }}>{dt("Записей в этом срезе нет", "No records in this view")}</div>
            <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12.5 }}>
              {needle ? dt("Нажмите Enter — поищем по смыслу во всей базе", "Press Enter to search the whole base by meaning")
                : dt("Добавьте заметку, ссылку или файл кнопкой «Запись»", "Add a note, link or file with the Record button")}
            </div>
          </div>
        )}
        {!loading && !failed && rows.length > 0 && (
          <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface" style={{ fontSize: 13 }}>
            <div role="row" className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
              style={{ gridTemplateColumns: COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
              <span className="px-3">{dt("Запись", "Record")}</span>
              <span className="px-2">{dt("Вид", "Kind")}</span>
              <span className="px-2">{dt("Рынок", "Market")}</span>
              <span className="px-2">{dt("Автор", "Author")}</span>
              <span className="px-3 text-right">{dt("Добавлена", "Added")}</span>
            </div>
            {rows.map((e) => <EntryRow key={e.id} e={e} onOpen={() => push({ view: "record", params: { id: e.id } })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryRow({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const dt = useDt();
  const preview = entryPreview(e);
  const who = entryImporterName(e);
  const when = new Date(e.entry_date || e.created_at);
  const [ru, en] = FACET_LABEL[entryFacet(e)];
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(); } }}
      className="grid cursor-pointer items-center border-b border-line transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      style={{ gridTemplateColumns: COLS, minHeight: 46 }}
    >
      <div className="min-w-0 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-ink">{deriveEntryTitle(e)}</span>
          {e.is_private && (
            <span className="shrink-0 text-ink-mute" title={dt("Личное хранилище", "Personal storage")}><RoyIcon name="lock" size={12} /></span>
          )}
        </div>
        {preview && <div className="truncate text-ink-mute" style={{ fontSize: 12 }}>{preview}</div>}
      </div>
      <div className="px-2">
        <span className="inline-flex h-[20px] items-center rounded-[5px] bg-surface-2 px-1.5 text-ink-soft" style={{ fontSize: 11 }}>{dt(ru, en)}</span>
      </div>
      <div className="flex gap-1 px-2">
        {(e.countries ?? []).length
          ? (e.countries ?? []).slice(0, 2).map((c) => (
            <span key={c} className="inline-flex h-[20px] items-center rounded-[5px] bg-surface-2 px-1.5 font-mono text-ink-soft" style={{ fontSize: 11 }}>{countryCode(c)}</span>
          ))
          : <span className="text-ink-mute">—</span>}
      </div>
      <div className="min-w-0 truncate px-2 text-ink-soft">{who || <span className="text-ink-mute">—</span>}</div>
      <div className="px-3 text-right font-mono text-ink-soft" style={{ fontSize: 12 }}>
        {isNaN(when.getTime()) ? "—" : when.toLocaleDateString(dt("ru-RU", "en-GB"), { day: "numeric", month: "short" }).replace(".", "")}
      </div>
    </div>
  );
}
