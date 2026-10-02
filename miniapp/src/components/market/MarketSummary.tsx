"use client";
// Сводка страны (первая секция по спеке): сколько точек у сетей сейчас, сколько открылось
// за год, последняя выручка Dodo, место Dodo среди пицца-сетей и есть ли проблемные источники.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { fmtEur, freshness } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { mono } from "./ui";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="text-ink-mute" style={{ fontSize: 12 }}>{label}</div>
      <div className="mt-1 font-semibold text-ink" style={{ ...mono, fontSize: 20 }}>{value}</div>
      {hint && <div className="mt-0.5 text-ink-mute" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export function MarketSummary({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const year = new Date().getFullYear();
  const s = useMemo(() => {
    const now = new Map<string, number>();
    for (const l of bundle.locations) if (aliveAtYearEnd([l], year)) now.set(l.chain_key, (now.get(l.chain_key) ?? 0) + 1);
    const pizza = bundle.chains.filter((c) => c.segment === "pizza").sort((a, b) => (now.get(b.key) ?? 0) - (now.get(a.key) ?? 0));
    const rank = pizza.findIndex((c) => c.key === "dodo");
    const openedThisYear = bundle.locations.filter((l) => l.opened?.startsWith(String(year))).length;
    const lastDodo = [...bundle.dodo].reverse().find((m) => m.revenue_eur !== null);
    const bad = freshness(bundle.sources, bundle.runs, new Date()).filter((f) => f.bad).length;
    return { total: [...now.values()].reduce((a, b) => a + b, 0), chains: now.size, rank, pizzaCount: pizza.length, openedThisYear, lastDodo, bad };
  }, [bundle, year]);

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
      <Stat label={dt("Точек сейчас", "Units now")} value={String(s.total)} hint={dt(`${s.chains} сетей`, `${s.chains} chains`)} />
      <Stat label={dt(`Открыто в ${year}`, `Opened in ${year}`)} value={String(s.openedThisYear)} />
      <Stat
        label={dt("Выручка Dodo, месяц", "Dodo revenue, month")}
        value={s.lastDodo ? fmtEur(s.lastDodo.revenue_eur) : "—"}
        hint={s.lastDodo?.month}
      />
      <Stat
        label={dt("Dodo среди пицца-сетей", "Dodo among pizza chains")}
        value={s.rank >= 0 ? `#${s.rank + 1}` : "—"}
        hint={s.pizzaCount ? dt(`из ${s.pizzaCount} по числу точек`, `of ${s.pizzaCount} by units`) : undefined}
      />
      <Stat
        label={dt("Источники", "Sources")}
        value={s.bad ? dt(`${s.bad} с проблемой`, `${s.bad} failing`) : dt("в порядке", "all fresh")}
      />
    </div>
  );
}
