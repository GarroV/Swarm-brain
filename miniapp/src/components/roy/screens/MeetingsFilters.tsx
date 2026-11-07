"use client";
import type { Entry } from "@/types";
import { useDt } from "../nav";
import { countryCode } from "@/lib/countries";
import { meetingSourceKey, sourceKeyLabel } from "@/lib/sourceLabels";
import { FilterChip, FilterGroup } from "./meetAdminPresentation";
import { EMPTY_FILTERS, isFilterActive, personOf, type MeetingsFilterState, type PeriodId } from "./meetingsFilter";

// ── Панель фильтров «Все встречи» ────────────────────────────────────────────
// Заменила собой блок статистики в правой колонке (сама статистика уехала под неё).
// Чипы несут количество: видно, где густо, и клик по цифре сразу сужает список — то, ради чего
// раньше приходилось глазами сверять список со сводкой.

const COPY = {
  allTime: { ru: "Всё время", en: "All time" },
  week: { ru: "Неделя", en: "Week" },
  month: { ru: "Месяц", en: "Month" },
  quarter: { ru: "Квартал", en: "Quarter" },
  custom: { ru: "Свой", en: "Custom" },
  found: { ru: "Найдено", en: "Found" },
  of: { ru: "из", en: "of" },
  total: { ru: "Всего", en: "Total" },
  reset: { ru: "Сбросить", en: "Reset" },
  search: { ru: "Поиск по названию…", en: "Search by title…" },
  period: { ru: "Период", en: "Period" },
  countries: { ru: "Страны", en: "Countries" },
  source: { ru: "Источник", en: "Source" },
  addedBy: { ru: "Кто добавил", en: "Added by" },
  storage: { ru: "Хранилище", en: "Storage" },
  status: { ru: "Статус", en: "Status" },
  anyStorage: { ru: "Любое", en: "Any" },
  shared: { ru: "Общее", en: "Shared" },
  personal: { ru: "Личное", en: "Personal" },
  anyStatus: { ru: "Любой", en: "Any" },
  confirmed: { ru: "Согласовано", en: "Confirmed" },
  pending: { ru: "На согласовании", en: "Pending review" },
} as const;

const PERIODS: Array<{ id: PeriodId; label: keyof typeof COPY }> = [
  { id: "all", label: "allTime" },
  { id: "week", label: "week" },
  { id: "month", label: "month" },
  { id: "quarter", label: "quarter" },
  { id: "custom", label: "custom" },
];

export function MeetingsFilters({
  all, shown, markets, value, onChange,
}: {
  all: Entry[];
  shown: number;
  markets: string[] | null;
  value: MeetingsFilterState;
  onChange: (f: MeetingsFilterState) => void;
}) {
  const dt = useDt();
  const tx = (key: keyof typeof COPY) => dt(COPY[key].ru, COPY[key].en);
  const set = (patch: Partial<MeetingsFilterState>) => onChange({ ...value, ...patch });
  // Переключение элемента множественного фильтра (страна/источник/человек).
  const toggle = (key: "countries" | "sources" | "people", v: string) => {
    const cur = value[key];
    set({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<MeetingsFilterState>);
  };

  // Счётчики считаем по ВСЕМ встречам, а не по отфильтрованным: иначе, сняв один фильтр,
  // пользователь видит нули у остальных и не понимает, куда делись данные.
  const countBy = (pick: (e: Entry) => string[]) => {
    const m = new Map<string, number>();
    all.forEach((e) => pick(e).forEach((k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const marketSet = new Set((markets ?? []).map(countryCode));
  const countryCounts = countBy((e) => (e.countries ?? []).map(countryCode))
    .filter(([c]) => marketSet.size === 0 || marketSet.has(c));
  const sourceCounts = countBy((e) => [meetingSourceKey(e)]);
  const peopleCounts = countBy((e) => [personOf(e)]);

  const active = isFilterActive(value);

  return (
    <div className="space-y-3 border-b border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink" style={{ fontSize: 12.5 }}>
          {active ? <>{tx("found")}: {shown} {tx("of")} {all.length}</> : <>{tx("total")}: {all.length}</>}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="font-semibold text-accent-ink transition-opacity hover:opacity-70"
            style={{ fontSize: 11.5 }}
          >
            {tx("reset")}
          </button>
        )}
      </div>

      <input
        value={value.query}
        onChange={(e) => set({ query: e.target.value })}
        placeholder={tx("search")}
        className="w-full rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-ink outline-none focus:border-[var(--accent-ink)]"
        style={{ fontSize: 12.5 }}
      />

      <FilterGroup title={tx("period")}>
        {PERIODS.map((p) => (
          <FilterChip key={p.id} label={tx(p.label)} active={value.period === p.id} onClick={() => set({ period: p.id })} />
        ))}
      </FilterGroup>
      {value.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })}
            className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1 text-ink outline-none" style={{ fontSize: 11.5 }} />
          <span className="text-ink-mute" style={{ fontSize: 11.5 }}>—</span>
          <input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })}
            className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1 text-ink outline-none" style={{ fontSize: 11.5 }} />
        </div>
      )}

      {countryCounts.length > 0 && (
        <FilterGroup title={tx("countries")}>
          {countryCounts.map(([c, n]) => (
            <FilterChip key={c} label={c} count={n} active={value.countries.includes(c)}
              onClick={() => toggle("countries", c)} />
          ))}
        </FilterGroup>
      )}

      {sourceCounts.length > 1 && (
        <FilterGroup title={tx("source")}>
          {sourceCounts.map(([src, n]) => (
            <FilterChip key={src} label={sourceKeyLabel(src, dt)} count={n} active={value.sources.includes(src)}
              onClick={() => toggle("sources", src)} />
          ))}
        </FilterGroup>
      )}

      {peopleCounts.length > 1 && (
        <FilterGroup title={tx("addedBy")}>
          {peopleCounts.map(([who, n]) => (
            <FilterChip key={who} label={who} count={n} active={value.people.includes(who)}
              onClick={() => toggle("people", who)} />
          ))}
        </FilterGroup>
      )}

      <FilterGroup title={tx("storage")}>
        {([["any", "anyStorage"], ["shared", "shared"], ["personal", "personal"]] as const).map(([id, label]) => (
          <FilterChip key={id} label={tx(label)} active={value.storage === id} onClick={() => set({ storage: id })} />
        ))}
      </FilterGroup>

      <FilterGroup title={tx("status")}>
        {([["any", "anyStatus"], ["confirmed", "confirmed"], ["pending", "pending"]] as const).map(([id, label]) => (
          <FilterChip key={id} label={tx(label)} active={value.status === id} onClick={() => set({ status: id })} />
        ))}
      </FilterGroup>
    </div>
  );
}

