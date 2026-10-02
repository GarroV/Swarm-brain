"use client";
// «Анализ рынка» (EN Market analysis) — решение владельца 02.10.2026, спека
// docs/superpowers/specs/2026-10-02-market-analysis-design.md. Страны — те, что видит
// воркспейс (allowed_markets, у демо — только выдуманная Demoland), данные приходят одним
// ответом GET /market/:cc, каждая секция подписывает свой источник и его свежесть.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { fetchMarket, fetchMarketCountries } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/countries";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { ChainDynamics } from "./ChainDynamics";
import { Freshness } from "./Freshness";
import { LocationRegistry } from "./LocationRegistry";
import { MarketMap } from "./MarketMap";
import { dropDeadChains } from "@/lib/marketInsights";
import { applyLocationDates, parseEditorial } from "@/lib/marketEditorial";
import { ChainTimeline } from "./ChainTimeline";
import { MarketTrend } from "./MarketTrend";
import { MarketSummary } from "./MarketSummary";
import { MoneySection } from "./MoneySection";
import { DeliverySection } from "./DeliverySection";
import { PizzaSection } from "./PizzaSection";
import { Empty } from "./ui";
import { MarketHeader } from "./MarketHeader";
import { ExportButtons } from "./ExportButtons";
import { TipProvider } from "./ref";
import { mktMono, mktSans } from "./fonts";
import "./market.css";

const LAST_KEY = "market_country";
const DEMO_COUNTRY = "XD";

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
function saveLast(cc: string) {
  try {
    localStorage.setItem(LAST_KEY, cc);
  } catch {
    // Приватное окно или запрет хранилища: страна просто не запомнится.
  }
}

export function MarketScreen() {
  const dt = useDt();
  const { me } = useRoyNav();
  const [countries, setCountries] = useState<string[] | null>(null);
  const [cc, setCc] = useState<string | null>(null);
  const [raw, setBundle] = useState<MarketBundle | null>(null);
  // Сети без единой работающей точки не показываются нигде (правило эталона). Уточнённые даты
  // открытия из ручной части (editorial.location_dates) — до всех расчётов, чтобы карта, таймлайн,
  // динамика и плитки считали от одной даты.
  const bundle = useMemo(() => {
    if (!raw) return null;
    const dates = parseEditorial(raw.editorial).locationDates;
    return dropDeadChains(dates.length ? { ...raw, locations: applyLocationDates(raw.locations, dates) } : raw);
  }, [raw]);
  const [failed, setFailed] = useState<"countries" | "country" | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setFailed(null);
    fetchMarketCountries()
      .then((list) => {
        setCountries(list);
        const last = readLast();
        setCc((cur) => cur ?? (last && list.includes(last) ? last : list[0] ?? null));
      })
      .catch((e) => {
        console.error("[MarketScreen] countries", e);
        setFailed("countries");
      });
  }, [reload]);

  useEffect(() => {
    if (!cc) return;
    let alive = true;
    setBundle((b) => (b?.country === cc ? b : null));
    fetchMarket(cc)
      .then((b) => alive && setBundle(b))
      .catch((e) => {
        console.error("[MarketScreen] country", cc, e);
        if (alive) setFailed("country");
      });
    return () => {
      alive = false;
    };
  }, [cc, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const pick = (c: string) => {
    setCc(c);
    saveLast(c);
  };
  const label = (c: string) => (c === DEMO_COUNTRY ? "🏳️ Demoland" : `${countryFlag(c)} ${countryName(c) || c}`);

  if (failed) {
    return (
      <div className="p-5">
        <Empty text={dt("Данные рынка не загрузились.", "Market data failed to load.")} />
        <button type="button" onClick={refresh} className="mt-2 text-accent-ink" style={{ fontSize: 13 }}>
          {dt("Повторить", "Retry")}
        </button>
      </div>
    );
  }
  if (countries && !countries.length) {
    return (
      <div className="p-5">
        <Empty
          text={dt(
            "Для рынков вашего воркспейса данных пока нет. Страны подключаются конфигом сборщика.",
            "No market data for your workspace's markets yet. Countries are added through the collector config.",
          )}
        />
      </div>
    );
  }

  return (
    <div className={`mkt h-full overflow-y-auto ${mktSans.variable} ${mktMono.variable}`}>
      <TipProvider>
        <div className="mkt-wrap">
          <div data-export="skip" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            {(countries?.length ?? 0) > 1
              ? (
                <div className="seg" role="group" aria-label={dt("Страна", "Country")}>
                  {(countries ?? []).map((c) => (
                    <button key={c} type="button" aria-pressed={c === cc} onClick={() => pick(c)}>{label(c)}</button>
                  ))}
                </div>
              )
              : <span />}
            {bundle && <ExportButtons country={bundle.country} name={countryName(bundle.country) || bundle.country} />}
          </div>
          {!bundle ? <Empty text={dt("Загружаю…", "Loading…")} /> : (
            <>
              <MarketHeader bundle={bundle} />
              <MarketSummary bundle={bundle} />
              <MarketMap bundle={bundle} />
              <ChainTimeline bundle={bundle} />
              <MarketTrend bundle={bundle} />
              <ChainDynamics bundle={bundle} />
              <PizzaSection bundle={bundle} />
              <DeliverySection bundle={bundle} />
              <MoneySection bundle={bundle} />
              <LocationRegistry bundle={bundle} />
              <Freshness bundle={bundle} isAdmin={!!me?.is_admin} onChanged={refresh} />
            </>
          )}
        </div>
      </TipProvider>
    </div>
  );
}
