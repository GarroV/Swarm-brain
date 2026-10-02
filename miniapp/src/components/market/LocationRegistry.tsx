"use client";
// «Реестр» эталона: поиск, выбор сети и статуса, галочка пекарен, счётчик; таблица .reg с
// сортировкой по клику на заголовок (↑/↓). Статус и проверка — метки .pill, у проверки в
// подсказке примечание проверяющего, источник — ссылка или начало строки источника.
import { useMemo, useState } from "react";
import type { MarketBundle, MarketLocation, MarketVerification } from "@/types";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtDate, RefSection, useChainColor, useChainOrder } from "./ref";
import { SourceCaption } from "./ui";

type Col = "c" | "n" | "city" | "a" | "o" | "s" | "v" | "f" | "src";
const COLS: Array<[Col, string, string]> = [
  ["c", "Сеть", "Chain"],
  ["n", "Название", "Name"],
  ["city", "Город", "City"],
  ["a", "Адрес", "Address"],
  ["o", "Открытие", "Opened"],
  ["s", "Статус", "Status"],
  ["v", "Проверка", "Check"],
  ["f", "Формат", "Format"],
  ["src", "Источник", "Source"],
];
const STATUS: Record<MarketLocation["status"], [string, string]> = {
  open: ["Работает", "Open"],
  closed: ["Закрыта", "Closed"],
  planned: ["Анонс", "Announced"],
  paused: ["Приостановлена", "Paused"],
};
// В фильтре статуса — как в эталоне: работает, закрыта, анонс.
const STATUS_FILTER: Array<MarketLocation["status"]> = ["open", "closed", "planned"];
const VLAB: Record<MarketVerification, [string, string]> = {
  confirmed: ["Подтверждено", "Confirmed"],
  corrected: ["Исправлено", "Corrected"],
  unverified: ["Не проверено", "Unverified"],
  added: ["Добавлено", "Added"],
  internal: ["Данные Dodo", "Dodo data"],
  official: ["Локатор сети", "Chain locator"],
};
const SRC_CHARS = 40;
// Сортировка по правилам языка страны (č, ș, õ…); код страны не всегда код языка.
const LANG_OF: Record<string, string> = { EE: "et" };

function collator(country: string): Intl.Collator {
  try {
    return new Intl.Collator(LANG_OF[country] ?? country.toLowerCase());
  } catch {
    return new Intl.Collator();
  }
}

export function LocationRegistry({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const col = useChainColor(bundle);
  const order = useChainOrder(bundle);
  const [q, setQ] = useState("");
  const [chain, setChain] = useState("");
  const [status, setStatus] = useState("");
  const [bakeries, setBakeries] = useState(false);
  const [sort, setSort] = useState<{ k: Col; dir: 1 | -1 }>({ k: "c", dir: 1 });
  const ch = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c])), [bundle.chains]);
  const cmp = useMemo(() => collator(bundle.country), [bundle.country]);
  const needle = q.trim().toLowerCase();

  const rows = useMemo(() => {
    const withBakeries = bakeries || !!ch.get(chain)?.is_bakery;
    const val = (l: MarketLocation): string => {
      switch (sort.k) {
        case "c": return (ch.get(l.chain_key)?.name ?? l.chain_key) + (l.opened || "0");
        case "n": return l.name;
        case "city": return l.city ?? "";
        case "a": return l.address ?? "";
        case "o": return l.opened || "0000";
        case "s": return l.status;
        case "v": return l.verification;
        case "f": return l.format ?? "";
        case "src": return l.source ?? "";
      }
    };
    return bundle.locations
      .filter((l) =>
        (withBakeries || !ch.get(l.chain_key)?.is_bakery) &&
        (!chain || l.chain_key === chain) &&
        (!status || l.status === status) &&
        (!needle || `${l.name} ${l.city ?? ""} ${l.address ?? ""}`.toLowerCase().includes(needle))
      )
      .map((l) => [val(l), l] as const)
      .sort((x, y) => cmp.compare(x[0], y[0]) * sort.dir)
      .map(([, l]) => l);
  }, [bundle.locations, bakeries, ch, chain, status, needle, sort, cmp]);
  if (!bundle.locations.length) return null;

  const onSort = (k: Col) => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }));

  return (
    <RefSection id="registry" eyebrow={dt("Реестр", "Registry")} title={dt("Все точки", "All locations")}>
      <div className="panel">
        <div className="tablebar">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={dt("Поиск по названию, городу, адресу", "Search by name, city, address")} aria-label={dt("Поиск", "Search")} />
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label={dt("Сеть", "Chain")}>
            <option value="">{dt("Все сети", "All chains")}</option>
            {order.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={dt("Статус", "Status")}>
            <option value="">{dt("Все статусы", "All statuses")}</option>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{dt(...STATUS[s])}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={bakeries} onChange={(e) => setBakeries(e.target.checked)} /> {dt("пекарни", "bakeries")}</label>
          <span className="muted">{dt(`${rows.length} записей`, `${rows.length} records`)}</span>
        </div>
        <div className="reg">
          <table>
            <thead>
              <tr>
                {COLS.map(([k, r, e]) => (
                  <th key={k} className="sortable" onClick={() => onSort(k)} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                    {dt(r, e)}{sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const src = l.source ?? "";
                return (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <i className="sw" style={{ display: "inline-block", background: col(l.chain_key), marginRight: 6, verticalAlign: -1 }} />
                      {ch.get(l.chain_key)?.name ?? l.chain_key}
                    </td>
                    <td>{l.name}</td>
                    <td>{l.city}</td>
                    <td>{l.address}{l.placement === "city" && <> <span className="muted">{dt("(коорд. по городу)", "(city coordinates)")}</span></>}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDate(l.opened, ru)}{l.opened_estimated && <span className="muted"> ~</span>}</td>
                    <td><span className={`pill ${l.status}`}>{dt(...STATUS[l.status])}{l.closed ? ` ${fmtDate(l.closed, ru)}` : ""}</span></td>
                    <td><span className={`pill v-${l.verification}`} title={l.verification_note ?? ""}>{VLAB[l.verification] ? dt(...VLAB[l.verification]) : "—"}</span></td>
                    <td className="muted">{l.format}</td>
                    <td>
                      {/^https?:/.test(src)
                        ? <a href={src.split(/[ ;(]/)[0]} target="_blank" rel="noopener noreferrer">{dt("ссылка", "link")}</a>
                        : <span className="muted">{src.slice(0, SRC_CHARS)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SourceCaption bundle={bundle} feeds="locations" />
    </RefSection>
  );
}
