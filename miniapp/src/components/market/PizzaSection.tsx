"use client";
// Секция эталона #pizza «Пицца-конкуренты»: таблица сетей, выручка на пиццерию, продажи и
// операции Dodo, цены и корзина, как работают сети, оценки по точкам — в порядке эталона.
// Ручная часть (editorial) — как есть; без неё каждый кусок берёт вычисленный вариант из
// базы или прячется. Прибыли нет нигде.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { unitGrowthIndex } from "@/lib/marketDodo";
import { useDt, useLang } from "@/components/roy/nav";
import { dodoBars, DodoMonthlyChart, secondDodoName } from "./DodoMonthly";
import { DodoOpsComputed, DodoOpsEditorial } from "./DodoOps";
import { PizzaPrices, priceTable } from "./PizzaPrices";
import { PizzaOpsModel, PizzaRatings } from "./PizzaRefTables";
import { computedPizza, editorialPizza, PizzaTable, PizzaUnitChart } from "./PizzaTable";
import { fmtDate, RefSection, useChainColor, useChainOrder, useEditorial } from "./ref";
import { SourceCaption } from "./ui";

export function PizzaSection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const ed = useEditorial(bundle);
  const color = useChainColor(bundle);
  const order = useChainOrder(bundle);
  const now = useMemo(() => new Date(), []);
  const model = useMemo(() => editorialPizza(ed, dt) ?? computedPizza(bundle, dt, ru, now.getFullYear()), [ed, bundle, dt, ru, now]);
  const dodo = useMemo(() => dodoBars(bundle, ed, now), [bundle, ed, now]);
  const matrix = useMemo(() => priceTable(bundle, ed, order.map((c) => c.key), dt), [bundle, ed, order, dt]);
  const names = useMemo(() => new Map([...ed.pizzaTable.map((r) => [r.chain, r.name] as const), ...bundle.chains.map((c) => [c.key, c.name] as const)]), [ed.pizzaTable, bundle.chains]);
  const name = (k: string) => names.get(k) ?? k;

  const t = ed.texts;
  const hasUnits = !!model && model.rows.some((r) => r.per.some((v) => v !== null));
  const hasDodo = dodo.bars.length > 0;
  const ops = ed.dodoOps.length
    ? <DodoOpsEditorial rows={ed.dodoOps} texts={t} country={bundle.country} />
    : <DodoOpsComputed bundle={bundle} now={now} />;
  const anything = model || hasDodo || bundle.dodo.length || matrix || ed.basket.length || ed.opsModel || ed.ratings.length;
  if (!anything) return null;

  const usesEditorial = ed.pizzaTable.length || ed.dodoMonthly.length || ed.dodoOps.length || ed.pricesCols.length || ed.basket.length || ed.opsModel || ed.ratings.length;
  const latestLocal = [...bundle.dodo].reverse().find((m) => m.revenue_local !== null && m.currency && m.currency !== "EUR");
  const dodoNote = t.dodo_note ?? (hasDodo
    ? dt(
      `Только полные месяцы работы: ${fmtDate(dodo.bars[0].m, ru)} – ${fmtDate(dodo.bars.at(-1)!.m, ru)}.`,
      `Full months of operation only: ${fmtDate(dodo.bars[0].m, ru)} – ${fmtDate(dodo.bars.at(-1)!.m, ru)}.`,
    ) + (unitGrowthIndex(dodo.bars.map((d) => d.units)) !== null ? dt(" Пунктир — запуск второй пиццерии.", " The dashed line marks the second pizzeria's launch.") : "") + (!dodo.editorial && latestLocal ? dt(` Продажи приходят в ${latestLocal.currency}; евро — по курсу ЕЦБ.`, ` Sales arrive in ${latestLocal.currency}; euro at the ECB rate.`) : "")
    : dt("Полных месяцев работы пока нет: пиццерии только открылись или на паузе.", "No full months of operation yet: pizzerias just opened or are paused."));

  // Таблицы эталона подписывают сеть коротко: «Dodo», а не «Dodo Pizza».
  const shortName = (k: string) => name(k).replace(/\s+Pizza$/, "");
  return (
    <RefSection
      id="pizza"
      eyebrow={dt("Пицца-конкуренты", "Pizza competitors")}
      title={t.pizza_title ?? dt("Dodo и пицца-сети", "Dodo and pizza chains")}
      lede={t.pizza ?? dt(
        "Выручка сетей — из годовой отчётности юрлиц. Выручка на пиццерию — выручка за год на сумму месяцев работы всех точек × 12; месяц открытия не считается. Dodo — продажи по месяцам из Dodo IS.",
        "Chain revenue is from annual company filings. Revenue per pizzeria is yearly revenue over the summed months of operation of all locations × 12; the opening month is excluded. Dodo — monthly sales from Dodo IS.",
      )}
    >
      {model && <PizzaTable model={model} color={color} />}
      {(hasUnits || bundle.dodo.length > 0 || hasDodo) && (
        <div className="pgrid">
          {hasUnits && model && (
            <div className="panel chartbox">
              <h3>{t.pizza_unit_title ?? dt("Выручка на одну пиццерию в год, € тыс.", "Revenue per pizzeria per year, € thousand")}</h3>
              <PizzaUnitChart model={model} color={color} />
              <p className="small">
                {t.pizza_unit_note ?? dt(
                  "Выручка за год, делённая на сумму месяцев работы всех точек и умноженная на 12.",
                  "Yearly revenue divided by the summed months of operation of all locations, times 12.",
                )}
              </p>
            </div>
          )}
          {(hasDodo || bundle.dodo.length > 0) && (
            <div className="panel chartbox">
              <h3>{t.dodo_title ?? dt("Dodo: продажи по месяцам, € тыс.", "Dodo: sales by month, € thousand")}</h3>
              {hasDodo && <DodoMonthlyChart bars={dodo.bars} editorial={dodo.editorial} second={ed.texts.dodo_second ?? secondDodoName(bundle)} vat={Number(ed.texts.dodo_vat) || null} />}
              <p className="small">{dodoNote}</p>
            </div>
          )}
        </div>
      )}
      {ops}
      <PizzaPrices bundle={bundle} ed={ed} matrix={matrix} />
      <PizzaOpsModel ed={ed} color={color} name={shortName} />
      <PizzaRatings ed={ed} color={color} name={shortName} />
      <SourceCaption bundle={bundle} feeds={usesEditorial ? ["financials", "dodo", "prices", "editorial"] : ["financials", "dodo", "prices"]} />
    </RefSection>
  );
}
