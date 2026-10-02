"use client";
// Доставка по образцу эталона: ключевые цифры рынка агрегаторов и наблюдения — из фактов
// ручной заливки (topic delivery / insight). Хроника доставки — в таймлайне, сделки — там же.
// Столбцов выручки платформ по годам пока нет: юрлица Wolt/Glovo/Bolt в базе не помечены
// как платформы (беклог).
import { useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { factCards } from "@/lib/marketInsights";
import { useDt, useLang } from "@/components/roy/nav";
import { Empty, FactTile, firstUrl, Section, SourceCaption } from "./ui";

const KEY_FIGURES = 6;
const INSIGHTS = 4;
const PROFIT = /profit|loss|dobit|gubit|прибыл|убыт/i;

export function DeliverySection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const now = useMemo(() => new Date(), []);
  const [allInsights, setAllInsights] = useState(false);
  const figures = useMemo(
    () => factCards(bundle.facts.filter((f) => f.topic === "delivery" && !PROFIT.test(`${f.value} ${f.text}`)), now, ru).slice(0, KEY_FIGURES),
    [bundle.facts, now, ru],
  );
  const insights = useMemo(() => bundle.facts.filter((f) => f.topic === "insight" && !PROFIT.test(f.text)), [bundle.facts]);
  if (!figures.length && !insights.length) {
    return (
      <Section title={dt("Рынок доставки", "Delivery market")}>
        <Empty text={dt("Фактов пока нет: ручной источник не заполнен.", "No facts yet: the manual source is empty.")} />
        <SourceCaption bundle={bundle} feeds="facts" />
      </Section>
    );
  }
  const shown = allInsights ? insights : insights.slice(0, INSIGHTS);
  return (
    <Section title={dt("Рынок доставки", "Delivery market")}>
      <p className="-mt-1 mb-3 max-w-[720px] text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          "Площадки сами число заказов не публикуют. Цифры — из отчётности их местных юрлиц, публикаций и оценок; выручка площадки — это её комиссии, а не оборот заказов. Тексты — на языке источника.",
          "Platforms do not publish order counts. Figures come from their local entities' filings, press and estimates; platform revenue is its commissions, not order turnover.",
        )}
      </p>
      {figures.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {figures.map((c, i) => <FactTile key={i} card={c} />)}
        </div>
      )}
      {insights.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13 }}>{dt("Наблюдения", "Observations")}</div>
          <ul className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
            {shown.map((f, i) => {
              const url = firstUrl(f.source);
              return (
                <li key={i} className="border-l-2 border-line pl-2.5 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  {f.text}
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="ml-1 text-accent-ink">↗</a>}
                </li>
              );
            })}
          </ul>
          {insights.length > INSIGHTS && (
            <button type="button" onClick={() => setAllInsights((v) => !v)} className="mt-2 text-accent-ink" style={{ fontSize: 12 }}>
              {allInsights ? dt("Свернуть", "Show less") : dt(`Ещё ${insights.length - INSIGHTS}`, `${insights.length - INSIGHTS} more`)}
            </button>
          )}
        </div>
      )}
      <SourceCaption bundle={bundle} feeds="facts" />
    </Section>
  );
}
