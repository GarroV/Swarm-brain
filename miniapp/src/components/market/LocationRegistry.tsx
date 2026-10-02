"use client";
// Реестр точек по образцу референса: поиск, выбор сети и статуса, флажок пекарен,
// сортировка по любой колонке, статус и проверка — цветными метками, ссылка на источник.
// До ~1000 строк без виртуализации; дальше показываем первые LIMIT и говорим об этом.
import { useMemo, useState } from "react";
import type { MarketBundle, MarketLocation } from "@/types";
import { chainColors } from "@/lib/marketMap";
import { useDt } from "@/components/roy/nav";
import { mono, ScrollX, Section, SourceCaption } from "./ui";

const LIMIT = 400;
type Col = "chain" | "name" | "city" | "address" | "opened" | "status" | "verification" | "format";
const STATUS: Record<MarketLocation["status"], [string, string, string]> = {
  open: ["Работает", "Open", "var(--mkt-s3)"],
  paused: ["Пауза", "Paused", "var(--mkt-s4)"],
  planned: ["Анонс", "Announced", "var(--mkt-s1)"],
  closed: ["Закрыта", "Closed", "var(--mkt-s8)"],
};
const VERIF: Record<string, [string, string, string]> = {
  official: ["Официально", "Official", "var(--mkt-s3)"],
  confirmed: ["Подтверждено", "Confirmed", "var(--mkt-s3)"],
  corrected: ["Исправлено", "Corrected", "var(--mkt-s1)"],
  added: ["Добавлено", "Added", "var(--mkt-s1)"],
  internal: ["Данные Dodo", "Dodo data", "var(--mkt-s2)"],
  unverified: ["Не проверено", "Unverified", "var(--ink-mute)"],
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full border px-2 py-px" style={{ fontSize: 11, color, borderColor: color }}>{label}</span>
  );
}

const safeHref = (s: string | null) => (s && /^https?:\/\//.test(s) ? s : null);

export function LocationRegistry({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const [q, setQ] = useState("");
  const [chain, setChain] = useState("");
  const [status, setStatus] = useState("");
  const [bakeries, setBakeries] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "chain", dir: 1 });
  const chainName = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const colors = useMemo(() => chainColors(bundle.chains, bundle.locations), [bundle.chains, bundle.locations]);
  const needle = q.trim().toLowerCase();

  const rows = useMemo(() => {
    const val = (l: MarketLocation, c: Col): string =>
      c === "chain" ? chainName.get(l.chain_key) ?? l.chain_key : c === "verification" ? l.verification : (l[c] ?? "");
    return bundle.locations
      .filter((l) =>
        (bakeries || !bakery.has(l.chain_key)) &&
        (!chain || l.chain_key === chain) &&
        (!status || l.status === status) &&
        (!needle || [l.name, l.city, l.address].some((s) => s?.toLowerCase().includes(needle)))
      )
      .sort((a, b) => {
        const x = val(a, sort.col), y = val(b, sort.col);
        // Пустое — всегда в конце, в какую сторону ни сортируй.
        if (!x !== !y) return x ? -1 : 1;
        // Внутри равных — сначала точки с городом: строки без города и адреса неотличимы.
        return sort.dir * x.localeCompare(y) || Number(!a.city) - Number(!b.city) || (a.city ?? "").localeCompare(b.city ?? "") || a.name.localeCompare(b.name);
      });
  }, [bundle.locations, bakeries, bakery, chain, status, needle, sort, chainName]);
  if (!bundle.locations.length) return null;

  const chains = bundle.chains.filter((c) => bakeries || !c.is_bakery).sort((a, b) => a.name.localeCompare(b.name));
  const COLS: Array<[Col, string, string]> = [
    ["chain", "Сеть", "Chain"],
    ["name", "Название", "Name"],
    ["city", "Город", "City"],
    ["address", "Адрес", "Address"],
    ["opened", "Открытие", "Opened"],
    ["status", "Статус", "Status"],
    ["verification", "Проверка", "Check"],
    ["format", "Формат", "Format"],
  ];
  const control = "rounded-lg border border-line bg-background px-3 py-1.5 text-ink outline-none focus:border-accent-line";

  return (
    <Section title={dt("Все точки", "All locations")}>
      <div className="mb-3 flex flex-wrap items-center gap-2" style={{ fontSize: 13 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={dt("Поиск по названию, городу, адресу", "Search by name, city, address")}
          className={`w-full sm:w-auto sm:min-w-[200px] sm:flex-1 ${control}`}
        />
        <select value={chain} onChange={(e) => setChain(e.target.value)} className={control} aria-label={dt("Сеть", "Chain")}>
          <option value="">{dt("Все сети", "All chains")}</option>
          {chains.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={control} aria-label={dt("Статус", "Status")}>
          <option value="">{dt("Все статусы", "All statuses")}</option>
          {(Object.keys(STATUS) as Array<MarketLocation["status"]>).map((s) => <option key={s} value={s}>{dt(STATUS[s][0], STATUS[s][1])}</option>)}
        </select>
        {bakery.size > 0 && (
          <label className="flex items-center gap-1.5 text-ink-soft">
            <input type="checkbox" checked={bakeries} onChange={(e) => setBakeries(e.target.checked)} className="accent-[var(--accent-ink)]" />
            {dt("пекарни", "bakeries")}
          </label>
        )}
        <span className="text-ink-mute" style={{ ...mono, fontSize: 12 }}>{dt(`${rows.length} записей`, `${rows.length} records`)}</span>
      </div>
      <ScrollX className="max-h-[520px] overflow-y-auto">
        <table className="w-full min-w-[900px] border-collapse" style={{ fontSize: 12.5 }}>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-left" style={{ fontSize: 10.5 }}>
              {COLS.map(([c, ru, en]) => (
                <th key={c} className="py-2 pl-3 font-semibold uppercase tracking-wide text-accent-ink" aria-sort={sort.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => setSort((s) => ({ col: c, dir: s.col === c ? (s.dir === 1 ? -1 : 1) : 1 }))} className="uppercase">
                    {dt(ru, en)}{sort.col === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className="py-2 pl-3 pr-3 font-semibold uppercase tracking-wide text-accent-ink">{dt("Источник", "Source")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIMIT).map((l) => {
              const [sRu, sEn, sColor] = STATUS[l.status];
              const v = VERIF[l.verification] ?? [l.verification, l.verification, "var(--ink-mute)"];
              const href = safeHref(l.source);
              return (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="py-2 pl-3">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
                      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: colors.get(l.chain_key) }} />
                      {chainName.get(l.chain_key) ?? l.chain_key}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-ink">{l.name}</td>
                  <td className="py-2 pl-3 text-ink">{l.city ?? "—"}</td>
                  <td className="py-2 pl-3 text-ink-soft">{l.address ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pl-3 pr-2 text-ink-soft" style={mono}>{l.opened ? `${l.opened}${l.opened_estimated ? "≈" : ""}` : "—"}</td>
                  <td className="py-2 pl-3">
                    <Pill label={dt(sRu, sEn)} color={sColor} />
                    {l.closed && <div className="mt-0.5 text-ink-mute" style={{ ...mono, fontSize: 11 }}>{l.closed}</div>}
                  </td>
                  <td className="py-2 pl-3" title={l.verification_note ?? undefined}><Pill label={dt(v[0], v[1])} color={v[2]} /></td>
                  <td className="max-w-[220px] py-2 pl-3 text-ink-mute"><span className="line-clamp-2" title={l.format ?? undefined}>{l.format ?? "—"}</span></td>
                  <td className="py-2 pl-3 pr-3">
                    {href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">{dt("ссылка", "link")}</a>
                      : <span className="text-ink-mute">{l.source_kind}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      {rows.length > LIMIT && (
        <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
          {dt(`Показаны первые ${LIMIT} из ${rows.length} — сузьте поиск.`, `Showing first ${LIMIT} of ${rows.length} — narrow the search.`)}
        </p>
      )}
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
