"use client";
// Первые блоки страны по образцу референса: полоса из четырёх ключевых цифр и карточки
// «Рынок в цифрах». Цифры считаются из реестра точек, юрлиц и продаж Dodo
// (lib/marketInsights.ts) и пересчитываются после каждого сбора; карточка без данных
// не показывается, а не рисует ноль.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import {
  chainCities,
  chainRevenue,
  cityShare,
  datedOpenings,
  dodoYoY,
  kpis,
  datedShare,
  openingsByChain,
  periods,
  perYear,
} from "@/lib/marketInsights";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { fmtMoney, revenuePerUnit } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";

type Dt = (ru: string, en: string) => string;

// Ниже этой доли точек с датой открытия выводы о темпе не показываем.
const MIN_DATED_SHARE = 20;
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const money = (v: number, ru: boolean) => fmtMoney(v, ru);
const num = (v: number, ru: boolean) => (ru ? String(v).replace(".", ",") : String(v));
const list = (xs: string[], dt: Dt) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${dt("и", "and")} ${xs.at(-1)}`);

function Kpi({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5" style={{ borderTop: "3px solid var(--accent-ink)" }}>
      <div className="font-bold text-accent-ink" style={{ fontSize: 26, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{value}</div>
      <div className="mt-1 text-ink" style={{ fontSize: 13 }}>{label}</div>
      {hint && <div className="mt-1 text-ink-soft" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

function Card({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="font-semibold text-accent-ink" style={{ fontSize: 13 }}>{title}</div>
      <div className="mt-1.5 font-bold text-ink" style={{ fontSize: 17, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{value}</div>
      <p className="mt-1.5 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

type CardData = { title: string; value: string; body: string };

function useCards(bundle: MarketBundle, now: Date, dt: Dt, ru: boolean): CardData[] {
  return useMemo(() => {
    const y = now.getFullYear();
    const p = periods(now);
    const bakery = new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key));
    const name = (k: string) => bundle.chains.find((c) => c.key === k)?.name ?? k;
    const span = (s: [number, number]) => `${s[0]}–${s[1]}`;
    const cards: CardData[] = [];
    const locs = bundle.locations;

    const early = datedOpenings(locs, bakery, p.early).length, recent = datedOpenings(locs, bakery, p.recent).length;
    const recentByChain = [...openingsByChain(locs, bakery, p.recent)];
    // Дата открытия известна у малой доли точек — темп, география и открытия по сетям
    // посчитаны бы по горстке точек и выглядели бы фактом. Вместо них — честная карточка.
    const dated = datedShare(locs, bakery, y);
    const trusted = dated >= MIN_DATED_SHARE;
    if (!trusted) {
      cards.push({
        title: dt("Даты открытия", "Opening dates"),
        value: dt(`известны у ${dated}% точек`, `known for ${dated}% of locations`),
        body: dt(
          `Темп и география открытий не считаются: по ${dated}% точек вывод был бы случайным. Даты появятся, когда точки сверят с источниками.`,
          `Opening pace and geography are not shown: ${dated}% of locations is too few to tell. Dates will appear once locations are checked against sources.`,
        ),
      });
    }
    if (trusted && early + recent > 0) {
      const e = perYear(early, p.earlyMonths), r = perYear(recent, p.recentMonths);
      const top = recentByChain.slice(0, 2).map(([k, n]) => `${name(k)} (${n})`);
      cards.push({
        title: dt("Темп открытий", "Opening pace"),
        value: dt(`${num(e, ru)} → ${num(r, ru)} в год`, `${e} → ${r} a year`),
        body: dt(
          `В ${span(p.early)} открывалось в среднем ${num(e, ru)} точек сетей в год, в ${span(p.recent)} — около ${num(r, ru)}.${top.length ? ` Больше всего открытий за ${span(p.recent)} у ${list(top, dt)}.` : ""}`,
          `In ${span(p.early)} chains opened ${e} locations a year on average, in ${span(p.recent)} about ${r}.${top.length ? ` Most openings in ${span(p.recent)}: ${list(top, dt)}.` : ""}`,
        ),
      });
    }

    // Главный город — где сейчас больше всего работающих точек сетей.
    const alive = locs.filter((l) => !bakery.has(l.chain_key) && aliveAtYearEnd([l], y, y) === 1);
    const cityCount = new Map<string, number>();
    for (const l of alive) if (l.city) cityCount.set(l.city, (cityCount.get(l.city) ?? 0) + 1);
    const [capital] = [...cityCount].sort((a, b) => b[1] - a[1]);
    const se = capital && cityShare(locs, bakery, p.early, capital[0]), sr = capital && cityShare(locs, bakery, p.recent, capital[0]);
    if (trusted && capital && se != null && sr != null) {
      const rc = new Map<string, number>();
      for (const l of datedOpenings(locs, bakery, p.recent)) if (l.city) rc.set(l.city, (rc.get(l.city) ?? 0) + 1);
      const tops = [...rc].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} — ${n}`);
      cards.push({
        title: dt("География открытий", "Where openings go"),
        value: `${capital[0]}: ${se}% → ${sr}%`,
        body: dt(
          `Доля открытий в ${capital[0]}: ${span(p.early)} — ${se}%, ${span(p.recent)} — ${sr}%. Больше всего открытий за ${span(p.recent)}: ${tops.join(", ")}.`,
          `Share of openings in ${capital[0]}: ${span(p.early)} — ${se}%, ${span(p.recent)} — ${sr}%. Most openings in ${span(p.recent)}: ${tops.join(", ")}.`,
        ),
      });
    }

    if (trusted && recentByChain.length) {
      const earlyByChain = openingsByChain(locs, bakery, p.early);
      const [lead] = recentByChain;
      cards.push({
        title: dt("Открытия по сетям", "Openings by chain"),
        value: recentByChain.slice(0, 3).map(([k, n]) => `${name(k)} +${n}`).join(", "),
        body: dt(
          `${name(lead[0])}: ${lead[1]} открытий за ${span(p.recent)} и ${earlyByChain.get(lead[0]) ?? 0} за ${span(p.early)}. Считаются точки с известной датой открытия.`,
          `${name(lead[0])}: ${lead[1]} openings in ${span(p.recent)} and ${earlyByChain.get(lead[0]) ?? 0} in ${span(p.early)}. Only locations with a known opening date count.`,
        ),
      });
    }

    const pizza = bundle.chains
      .filter((c) => c.segment === "pizza")
      .map((c) => ({ c, n: alive.filter((l) => l.chain_key === c.key).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    if (pizza.length) {
      const where = pizza.slice(0, 2).map(({ c }) => `${c.name} — ${chainCities(locs, c.key, y).slice(0, 4).join(", ")}`);
      const paused = locs.filter((l) => l.chain_key === "dodo" && l.status === "paused").length;
      cards.push({
        title: dt("Пицца-сети", "Pizza chains"),
        // В заголовке — два крупнейших и Dodo, если он не среди них: раздел делается для Dodo.
        value: [...pizza.slice(0, 2), ...pizza.slice(2).filter(({ c }) => c.key === "dodo")].map(({ c, n }) => `${c.name}\u00a0${n}`).join(" · "),
        body: dt(
          `Где работают: ${where.join("; ")}.${paused ? ` У Dodo на паузе: ${paused}.` : ""}`,
          `Where they operate: ${where.join("; ")}.${paused ? ` Dodo paused: ${paused}.` : ""}`,
        ),
      });
    }

    const finYears = bundle.financials.filter((f) => f.revenue_eur !== null).map((f) => f.year);
    if (finYears.length && pizza.length) {
      const fy = Math.max(...finYears);
      const rev = chainRevenue(bundle, fy);
      const per = pizza
        .map(({ c }) => ({ c, v: rev.has(c.key) ? revenuePerUnit({ revenue_eur: rev.get(c.key)!, year: fy }, locs.filter((l) => l.chain_key === c.key)) : null }))
        .filter((x): x is { c: typeof x.c; v: number } => x.v !== null)
        .sort((a, b) => b.v - a.v);
      if (per.length) {
        cards.push({
          title: dt(`Выручка на пиццерию в год, ${fy}`, `Revenue per pizzeria, ${fy}`),
          value: `${per[0].c.name} ${money(per[0].v, ru)}`,
          body: per.length > 1
            ? per.slice(1).map((x) => `${x.c.name} — ${money(x.v, ru)}`).join(", ") + "."
            : dt("По остальным пицца-сетям нет выручки или дат открытия точек.", "No revenue or unit dates for other pizza chains."),
        });
      }
    }

    const yoy = dodoYoY(bundle.dodo);
    if (yoy) {
      const M = ru ? MONTHS_RU : MONTHS_EN;
      const mon = (m: string) => M[Number(m.slice(5, 7)) - 1];
      const range = `${mon(yoy.months[0])}${yoy.months.length > 1 ? `–${mon(yoy.months.at(-1)!)}` : ""} ${yoy.months.at(-1)!.slice(0, 4)}`;
      const sign = yoy.change > 0 ? "+" : yoy.change < 0 ? "−" : "";
      const [u0, u1] = yoy.units;
      cards.push({
        title: dt("Продажи Dodo", "Dodo sales"),
        value: dt(`${range}: ${sign}${num(Math.abs(yoy.change), ru)}% г/г`, `${range}: ${sign}${Math.abs(yoy.change)}% y/y`),
        body: u0 === u1
          ? dt(`В оба периода работало пиццерий: ${u1 ?? "—"}.`, `Pizzerias in both periods: ${u1 ?? "—"}.`)
          : dt(`Пиццерий год назад — ${u0 ?? "—"}, сейчас — ${u1 ?? "—"}.`, `Pizzerias a year ago — ${u0 ?? "—"}, now — ${u1 ?? "—"}.`),
      });
    }
    return cards;
  }, [bundle, now, dt, ru]);
}

export function MarketSummary({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const now = useMemo(() => new Date(), []);
  const k = useMemo(() => kpis(bundle, now), [bundle, now]);
  const cards = useCards(bundle, now, dt, ru);
  const y = now.getFullYear();
  const brands = k.newBrands.map((b) => (b.planned ? dt(`${b.name} — анонс`, `${b.name} — announced`) : `${b.name} ${b.year}`));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          value={String(k.restaurants)}
          label={dt("ресторанов сетей работает", "chain restaurants operating")}
          hint={k.bakeries ? dt(`без учёта ${k.bakeries} пекарен и кафе (${k.bakeryNames.join(", ")})`, `excluding ${k.bakeries} bakeries and cafés (${k.bakeryNames.join(", ")})`) : undefined}
        />
        <Kpi
          value={String(k.openings)}
          label={dt(`открытий с датой ${k.from}–${y}`, `dated openings ${k.from}–${y}`)}
          hint={dt(
            `${k.closures} закрытий за тот же период; у ${k.undated} работающих точек дата неизвестна`,
            `${k.closures} closures in the same period; ${k.undated} operating locations have no date`,
          )}
        />
        <Kpi
          value={String(k.newBrands.length)}
          label={dt(`новых брендов с ${k.from - 1}`, `new brands since ${k.from - 1}`)}
          hint={brands.length ? brands.join(", ") : dt("по году входа сетей и датам первых точек", "by chain entry year and first-location dates")}
        />
        {k.topRevenue
          ? (
            <Kpi
              value={money(k.topRevenue.revenue, ru)}
              label={dt(`выручка ${k.topRevenue.name} ${k.topRevenue.year}`, `${k.topRevenue.name} revenue ${k.topRevenue.year}`)}
              hint={k.topRevenue.units > k.topRevenue.othersUnits
                ? dt(`${k.topRevenue.units} ресторанов, больше всех остальных сетей вместе`, `${k.topRevenue.units} restaurants, more than all other chains combined`)
                : dt(`${k.topRevenue.units} ресторанов`, `${k.topRevenue.units} restaurants`)}
            />
          )
          : <Kpi value="—" label={dt("выручка сетей", "chain revenue")} hint={dt("отчётов юрлиц пока нет", "no company filings yet")} />}
      </div>
      {cards.length > 0 && (
        <section className="pt-3">
          <div className="mb-0.5 font-semibold uppercase tracking-wider text-accent-ink" style={{ fontSize: 11 }}>{dt("Ключевые цифры", "Key figures")}</div>
          <h2 className="font-bold text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>{dt("Рынок в цифрах", "The market in numbers")}</h2>
          <p className="mb-3 mt-1 max-w-[680px] text-ink-soft" style={{ fontSize: 13 }}>
            {dt(
              "Открытия с известной датой, выручки юрлиц и продажи Dodo. Ниже на странице — данные, из которых взяты эти цифры.",
              "Openings with a known date, company revenues and Dodo sales. The data behind these figures is further down the page.",
            )}
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => <Card key={c.title} {...c} />)}
          </div>
        </section>
      )}
    </div>
  );
}
