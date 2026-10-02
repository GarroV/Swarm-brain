"use client";
// Реестр точек таблицей: поиск по названию/городу/адресу, фильтр статуса. До ~1000 строк —
// без виртуализации; дальше показываем первые LIMIT и говорим об этом.
import { useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { useDt } from "@/components/roy/nav";
import { Chip, mono, Section, SourceCaption } from "./ui";

const LIMIT = 400;
type StatusFilter = "all" | "open" | "closed" | "unverified";

export function LocationRegistry({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const chainName = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() =>
    bundle.locations
      .filter((l) =>
        (status === "all" || (status === "unverified" ? l.verification === "unverified" : l.status === status)) &&
        (!needle ||
          [l.name, l.city, l.address, chainName.get(l.chain_key)].some((s) => s?.toLowerCase().includes(needle)))
      )
      .sort((a, b) => (chainName.get(a.chain_key) ?? "").localeCompare(chainName.get(b.chain_key) ?? "") || (a.city ?? "").localeCompare(b.city ?? "")),
    [bundle.locations, status, needle, chainName]);
  if (!bundle.locations.length) return null;

  const FILTERS: Array<[StatusFilter, string, string]> = [
    ["all", "Все", "All"],
    ["open", "Работают", "Open"],
    ["closed", "Закрыты", "Closed"],
    ["unverified", "Не проверены", "Unverified"],
  ];
  return (
    <Section title={dt("Реестр точек", "Location registry")} aside={<span className="text-ink-mute" style={{ ...mono, fontSize: 12 }}>{rows.length}</span>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={dt("Сеть, город или адрес", "Chain, city or address")}
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-ink outline-none focus:border-accent-line"
          style={{ fontSize: 13 }}
        />
        {FILTERS.map(([id, ru, en]) => <Chip key={id} active={status === id} onClick={() => setStatus(id)}>{dt(ru, en)}</Chip>)}
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse" style={{ fontSize: 12 }}>
          <thead className="sticky top-0 bg-surface">
            <tr className="text-left text-ink-mute">
              <th className="py-1.5 pr-3 font-medium">{dt("Сеть", "Chain")}</th>
              <th className="py-1.5 pr-3 font-medium">{dt("Точка", "Location")}</th>
              <th className="py-1.5 pr-3 font-medium">{dt("Город", "City")}</th>
              <th className="py-1.5 pr-3 font-medium">{dt("Открыта", "Opened")}</th>
              <th className="py-1.5 pr-3 font-medium">{dt("Статус", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIMIT).map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink-soft">{chainName.get(l.chain_key) ?? l.chain_key}</td>
                <td className="py-1.5 pr-3">
                  <div className="text-ink">{l.name}</div>
                  {l.address && <div className="text-ink-mute">{l.address}</div>}
                </td>
                <td className="py-1.5 pr-3 text-ink-soft">{l.city ?? "—"}</td>
                <td className="py-1.5 pr-3 text-ink-soft" style={mono}>{l.opened ?? "—"}{l.opened_estimated ? "≈" : ""}</td>
                <td className="py-1.5 pr-3">
                  <span className={l.status === "closed" ? "text-destructive" : "text-ink-soft"}>
                    {l.status === "closed" ? `${dt("закрыта", "closed")} ${l.closed ?? ""}` : l.status === "open" ? dt("работает", "open") : l.status}
                  </span>
                  {l.verification === "unverified" && <span className="ml-1.5 text-ink-mute">· {dt("не проверено", "unverified")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > LIMIT && (
        <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
          {dt(`Показаны первые ${LIMIT} из ${rows.length} — сузьте поиск.`, `Showing first ${LIMIT} of ${rows.length} — narrow the search.`)}
        </p>
      )}
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
