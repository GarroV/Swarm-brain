"use client";
// Dodo в стране: выручка по месяцам (публичный API Dodo) и заказы по каналам. Неполный
// месяц (текущий — дни ещё идут) показан штриховкой, чтобы его не сравнивали с полными.
import type { MarketBundle } from "@/types";
import { fmtEur, orderChannels } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { mono, Section, SourceCaption } from "./ui";

const CHANNEL: Record<string, [string, string, number]> = {
  aggregator: ["агрегаторы", "aggregators", 4],
  site: ["сайт", "website", 1],
  mobile: ["приложение", "app", 2],
  restaurant: ["зал", "dine-in", 3],
  pizzeria: ["пиццерия", "pizzeria", 3],
  phone: ["телефон", "phone", 5],
  kiosk: ["киоск", "kiosk", 5],
};
const MONTHS = 12;

export function DodoSection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const months = bundle.dodo.slice(-MONTHS);
  if (!months.length) return null;
  const revMax = Math.max(1, ...months.map((m) => m.revenue_eur ?? 0));
  const totals = months.map((m) => Object.values(orderChannels(m.orders)).reduce((s, v) => s + v, 0));
  const ordMax = Math.max(1, ...totals);
  const channels = [...new Set(months.flatMap((m) => Object.keys(orderChannels(m.orders))))];
  // Выручка приходит из FinancialMetrics только за прошедший месяц целиком; «неполный»
  // относится к заказам по дням, у выручки его не бывает.
  const hasRevenue = months.some((m) => m.revenue_eur !== null);
  const latestLocal = [...months].reverse().find((m) => m.revenue_local !== null && m.currency && m.currency !== "EUR");

  return (
    <Section title={dt("Dodo в стране", "Dodo in the country")}>
      {hasRevenue && (
        <>
          <h3 className="mb-2 text-ink-soft" style={{ fontSize: 13 }}>{dt("Выручка по месяцам, €", "Revenue by month, €")}</h3>
          <div className="mb-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m) => (
              <div key={m.month} className="flex flex-col items-center gap-0.5" title={`${m.month}: ${fmtEur(m.revenue_eur)}${m.units ? ` · ${m.units}` : ""}`}>
                <span className="text-ink-soft" style={{ ...mono, fontSize: 9 }}>{fmtEur(m.revenue_eur)}</span>
                <div className="flex h-24 w-full items-end justify-center">
                  <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="h-full w-3/4">
                    <rect
                      x={0}
                      width={10}
                      y={100 - ((m.revenue_eur ?? 0) / revMax) * 100}
                      height={((m.revenue_eur ?? 0) / revMax) * 100}
                      fill="var(--chart-1)"
                    />
                  </svg>
                </div>
                <span className="text-ink-mute" style={{ ...mono, fontSize: 9 }}>{m.month.slice(2)}</span>
              </div>
            ))}
          </div>
          {latestLocal && (
            <p className="mb-3 text-ink-mute" style={{ fontSize: 12 }}>
              {dt(
                `Выручка приходит в ${latestLocal.currency}; евро — по курсу ЕЦБ.`,
                `Revenue arrives in ${latestLocal.currency}; euro at the ECB rate.`,
              )}
            </p>
          )}
        </>
      )}
      {channels.length > 0 && (
        <>
          <h3 className="mb-2 text-ink-soft" style={{ fontSize: 13 }}>{dt("Заказы по каналам", "Orders by channel")}</h3>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m, i) => {
              const ch = orderChannels(m.orders);
              const days = Object.keys((m.orders?._days as Record<string, unknown> | undefined) ?? {}).length;
              return (
                <div key={m.month} className="flex flex-col items-center gap-0.5">
                  <div className="flex h-24 w-3/4 flex-col-reverse" title={`${m.month}: ${totals[i]}${m.complete ? "" : ` · ${dt(`дней: ${days}`, `days: ${days}`)}`}`} style={{ opacity: m.complete ? 1 : 0.55 }}>
                    {channels.map((c) => (
                      <div key={c} style={{ height: `${((ch[c] ?? 0) / ordMax) * 100}%`, background: `var(--chart-${CHANNEL[c]?.[2] ?? 5})` }} />
                    ))}
                  </div>
                  <span className="text-ink-mute" style={{ ...mono, fontSize: 9 }}>{m.month.slice(2)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-ink-soft" style={{ fontSize: 12 }}>
            {channels.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm" style={{ background: `var(--chart-${CHANNEL[c]?.[2] ?? 5})` }} />
                {CHANNEL[c] ? dt(CHANNEL[c][0], CHANNEL[c][1]) : c}
              </span>
            ))}
            <span className="text-ink-mute">{dt("бледнее — собраны не все дни месяца", "faded — not every day of the month collected")}</span>
          </div>
        </>
      )}
      <SourceCaption bundle={bundle} feeds="dodo" />
    </Section>
  );
}
