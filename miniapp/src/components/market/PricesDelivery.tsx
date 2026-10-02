"use client";
// Цены (медиана пиццы ~30 см по сетям) и рынок доставки (факты и таймлайн). Оба —
// ручные источники: на сайтах сетей и в агрегаторах автоматизации нет (спека).
import type { MarketBundle, MarketFact } from "@/types";
import { medianPizza30 } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { Empty, mono, Section, SourceCaption } from "./ui";

function FactList({ facts }: { facts: MarketFact[] }) {
  return (
    <ul className="space-y-1.5" style={{ fontSize: 13 }}>
      {facts.map((f) => (
        <li key={`${f.topic}|${f.text}`} className="flex gap-3">
          {f.date && <span className="w-16 shrink-0 text-ink-mute" style={mono}>{f.date}</span>}
          <span className="text-ink">
            {f.text}
            {f.value && <b className="ml-1.5 font-semibold">{f.value}</b>}
            {f.source && /^https?:\/\//.test(f.source) && (
              <a href={f.source} target="_blank" rel="noreferrer noopener" className="ml-1.5 text-accent-ink underline-offset-2 hover:underline">↗</a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PricesDelivery({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const pizza = bundle.chains
    .map((c) => ({ c, v: medianPizza30(bundle.prices, c.key) }))
    .filter((x): x is { c: typeof x.c; v: number } => x.v !== null)
    .sort((a, b) => a.v - b.v);
  const max = Math.max(1, ...pizza.map((p) => p.v));
  const delivery = bundle.facts.filter((f) => f.topic === "delivery");
  const timeline = bundle.facts.filter((f) => f.topic === "timeline").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const market = bundle.facts.filter((f) => f.topic === "market" || f.topic === "deal" || f.topic === "insight");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={dt("Цена пиццы ~30 см", "Pizza ~30 cm price")}>
        {!pizza.length ? <Empty text={dt("Цен пока нет: ручной источник не заполнен.", "No prices yet: the manual source is empty.")} /> : (
          <div className="space-y-1.5">
            {pizza.map(({ c, v }) => (
              <div key={c.key} className="grid grid-cols-[120px_1fr_56px] items-center gap-2" style={{ fontSize: 12 }}>
                <span className={c.key === "dodo" ? "font-semibold text-ink" : "text-ink-soft"}>{c.name}</span>
                <div className="h-2.5 rounded-sm bg-surface-2">
                  <div className="h-full rounded-sm" style={{ width: `${(v / max) * 100}%`, background: c.key === "dodo" ? "var(--chart-1)" : "var(--chart-2)" }} />
                </div>
                <span className="text-right text-ink" style={mono}>€{v.toFixed(2)}</span>
              </div>
            ))}
            <p className="pt-1 text-ink-mute" style={{ fontSize: 12 }}>{dt("Медиана по позициям 28–32 см.", "Median of 28–32 cm items.")}</p>
          </div>
        )}
        <SourceCaption bundle={bundle} feeds="prices" />
      </Section>
      <Section title={dt("Рынок доставки", "Delivery market")}>
        {!delivery.length && !timeline.length && !market.length
          ? <Empty text={dt("Фактов пока нет: ручной источник не заполнен.", "No facts yet: the manual source is empty.")} />
          : (
            <div className="space-y-4">
              {delivery.length > 0 && <FactList facts={delivery} />}
              {timeline.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-ink-soft" style={{ fontSize: 13 }}>{dt("Хронология", "Timeline")}</h3>
                  <FactList facts={timeline} />
                </div>
              )}
              {market.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-ink-soft" style={{ fontSize: 13 }}>{dt("Рынок и сделки", "Market and deals")}</h3>
                  <FactList facts={market} />
                </div>
              )}
            </div>
          )}
        <SourceCaption bundle={bundle} feeds="facts" />
      </Section>
    </div>
  );
}
