"use client";
// Шапка и четыре плитки эталона. Плитки 1–2 и цифра 4-й считаются из реестра и отчётности
// (обновляются со сбором), 3-я и подпись 4-й — из ручной части (editorial.kpis), как в эталоне.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { countryName } from "@/lib/countries";
import { kpis, yearOf } from "@/lib/marketInsights";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { useDt, useLang } from "@/components/roy/nav";
import { dec, useEditorial } from "./ref";

const FIRST_YEAR = 2021;

type Tile = { value: string; label: string; note: string | null };

export function MarketHeader({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const ed = useEditorial(bundle);
  const year = new Date().getFullYear();
  const name = countryName(bundle.country) || bundle.country;

  const tiles = useMemo<Tile[]>(() => {
    const bakery = new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key));
    const rest = bundle.locations.filter((l) => !bakery.has(l.chain_key));
    const bakeries = bundle.locations.length - rest.length;
    const bakeryNames = ed.texts.bakery_names ?? bundle.chains.filter((c) => c.is_bakery).map((c) => c.name).join(", ");
    const opened = rest.filter((l) => (yearOf(l.opened) ?? 0) >= FIRST_YEAR && (yearOf(l.opened) ?? 0) <= year && l.status !== "planned").length;
    const closed = rest.filter((l) => l.status === "closed" && (yearOf(l.closed) ?? 0) >= FIRST_YEAR).length;
    const undated = rest.filter((l) => l.status === "open" && !l.opened).length;
    const out: Tile[] = [
      {
        value: String(rest.filter((l) => l.status === "open").length),
        label: dt("ресторанов сетей работает", "chain restaurants open"),
        note: bakeries ? dt(`без учёта ${bakeries} пекарен и кафе-баров (${bakeryNames})`, `excluding ${bakeries} bakeries and café bars (${bakeryNames})`) : null,
      },
      {
        value: String(opened),
        label: dt(`открытий с датой ${FIRST_YEAR}–${year}`, `dated openings ${FIRST_YEAR}–${year}`),
        note: dt(`${closed} закрытий за тот же период; у ${undated} работающих точек дата неизвестна`, `${closed} closures in the same period; ${undated} open locations have no date`),
      },
    ];
    const curated = ed.kpis[2];
    if (curated?.value && curated.label) out.push({ value: curated.value, label: curated.label, note: curated.note });
    const leader = kpis(bundle, new Date()).topRevenue;
    if (leader) {
      const units = aliveAtYearEnd(bundle.locations.filter((l) => l.chain_key === leader.chain), leader.year, year);
      out.push({
        value: `€${dec(leader.revenue / 1e6, 1, ru)} ${dt("млн", "M")}`,
        label: dt(`выручка ${leader.name} ${leader.year}`, `${leader.name} revenue ${leader.year}`),
        note: ed.kpis[3]?.note ?? (units ? dt(`${units} точек на конец ${leader.year}`, `${units} locations at the end of ${leader.year}`) : null),
      });
    }
    return out;
  }, [bundle, ed.kpis, ed.texts.bakery_names, dt, ru, year]);

  const h = ed.header;
  return (
    <>
      <header>
        <span className="ov1" />
        <span className="ov2" />
        <div className="brand">{h?.brand ?? "DODO BRANDS"}</div>
        <div className="eyebrow">{h?.eyebrow ?? dt(`Рынок QSR · ${name} · ${FIRST_YEAR} – ${year}`, `QSR market · ${name} · ${FIRST_YEAR} – ${year}`)}</div>
        <h1>{h?.title ?? dt(`${name}: карта сетей быстрого питания`, `${name}: fast-food chain map`)}</h1>
        <p className="lede">
          {h?.lede ?? dt(
            "Точки сетей быстрого питания: адреса, даты открытия, плотность на карте, хронология экспансии и выручки операторов.",
            "Fast-food chain locations: addresses, opening dates, map density, expansion timeline and operator revenue.",
          )}
        </p>
        <div className="meta">
          <span>{dt(`${bundle.locations.length} записей · ${bundle.chains.length} сетей`, `${bundle.locations.length} records · ${bundle.chains.length} chains`)}</span>
          {h?.sources && <span>{h.sources}</span>}
        </div>
      </header>
      <div className="kpis">
        {tiles.map((t) => (
          <div key={t.label} className="kpi">
            <b>{t.value}</b>
            <span>{t.label}</span>
            {t.note && <small>{t.note}</small>}
          </div>
        ))}
      </div>
    </>
  );
}

