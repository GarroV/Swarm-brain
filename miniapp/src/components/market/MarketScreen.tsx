"use client";
// «Анализ рынка» (EN Market analysis) — решение владельца 02.10.2026, спека
// docs/superpowers/specs/2026-10-02-market-analysis-design.md. Страны — те, что видит
// воркспейс (allowed_markets, у демо — только выдуманная Demoland), данные приходят одним
// ответом GET /market/:cc, каждая секция подписывает свой источник и его свежесть.
import { useCallback, useEffect, useState } from "react";
import type { MarketBundle } from "@/types";
import { fetchMarket, fetchMarketCountries } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/countries";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { ChainDynamics } from "./ChainDynamics";
import { DodoSection } from "./DodoSection";
import { Freshness } from "./Freshness";
import { LocationRegistry } from "./LocationRegistry";
import { MarketMap } from "./MarketMap";
import { MoneySection } from "./MoneySection";
import { PricesDelivery } from "./PricesDelivery";
import { Chip, Empty } from "./ui";

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
  const [bundle, setBundle] = useState<MarketBundle | null>(null);
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-4 px-4 py-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(countries ?? []).map((c) => <Chip key={c} active={c === cc} onClick={() => pick(c)}>{label(c)}</Chip>)}
        </div>
        {!bundle ? <Empty text={dt("Загружаю…", "Loading…")} /> : (
          <>
            <MarketMap bundle={bundle} />
            <ChainDynamics bundle={bundle} />
            <MoneySection bundle={bundle} />
            <DodoSection bundle={bundle} />
            <PricesDelivery bundle={bundle} />
            <LocationRegistry bundle={bundle} />
            <Freshness bundle={bundle} isAdmin={!!me?.is_admin} onChanged={refresh} />
          </>
        )}
      </div>
    </div>
  );
}
