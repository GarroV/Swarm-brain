"use client";
// Цены пицц ~30 см (#prT эталона) и корзина (#bkT). Колонки — из ручной части
// (editorial.prices_cols), без неё — сеть × канал по ценам в базе (priceMatrix). Цены — всегда
// из базы (bundle.prices). Подсвечена самая низкая цена в строке, как в эталоне.
import type { MarketBundle } from "@/types";
import type { Editorial } from "@/lib/marketEditorial";
import { channelOf, priceMatrix, type PriceCell, type PizzaType, refPriceRows, rowBest } from "@/lib/marketPizza";
import { useDt, useLang } from "@/components/roy/nav";
import { dec, fmtDate } from "./ref";

const PIZZA: Record<PizzaType, [string, string]> = {
  margherita: ["Маргарита", "Margherita"],
  pepperoni: ["Пепперони / колбаса", "Pepperoni / sausage"],
  ham_mushroom: ["Каприччоза", "Capricciosa"],
  premium: ["Премиум (4 сыра)", "Premium (4 cheese)"],
};
const CHANNEL: Record<ReturnType<typeof channelOf>, [string, string]> = { site: ["сайт", "site"], wolt: ["Wolt", "Wolt"], glovo: ["Glovo", "Glovo"], other: ["другое", "other"] };

type Matrix = { heads: string[]; rows: Array<{ type: PizzaType; cells: Array<PriceCell | null>; best: number | null }> };

export function priceTable(bundle: MarketBundle, ed: Editorial, chainOrder: string[], dt: (ru: string, en: string) => string): Matrix | null {
  if (ed.pricesCols.length) {
    const rows = refPriceRows(bundle.prices, ed.pricesCols);
    return rows.some((r) => r.best !== null) ? { heads: ed.pricesCols.map((c) => c.title), rows } : null;
  }
  const m = priceMatrix(bundle.prices, chainOrder);
  if (!m.rows.length) return null;
  const name = new Map(bundle.chains.map((c) => [c.key, c.name]));
  return {
    heads: m.cols.map((c) => `${name.get(c.chain) ?? c.chain}, ${dt(...CHANNEL[c.channel])}`),
    rows: m.rows.map((r) => ({ ...r, best: rowBest(r.cells) })),
  };
}

export function PizzaPrices({ bundle, ed, matrix }: { bundle: MarketBundle; ed: Editorial; matrix: Matrix | null }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const eur = (v: number) => `€${dec(v, 2, ru)}`;
  const pricesOn = bundle.prices.map((p) => p.seen_on).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const basket = ed.basket;
  if (!matrix && !basket.length) return null;
  const min = (vals: number[]) => (vals.length ? Math.min(...vals) : null);
  const bestOne = min(basket.map((b) => b.one)), bestTwo = min(basket.map((b) => b.two).filter((v) => v > 0));
  const title = ed.texts.prices_title
    ?? dt("Цены, средняя пицца ~30 см", "Prices, medium pizza ~30 cm") + (pricesOn ? `, ${fmtDate(pricesOn, ru)}` : "");
  const note = ed.texts.prices_note
    ?? dt("Позиция каждого вида ближе всего к 30 см; ниже — цена за 100 см². Подсвечена самая низкая цена в строке.", "For each kind, the item closest to 30 cm; below — price per 100 cm². The lowest price in a row is highlighted.");
  return (
    <>
      <div className="sec-head" style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 16 }}>{title}</h3>
        <p className="small">{note}</p>
      </div>
      {matrix && (
        <div className="panel scroll">
          <table>
            <thead>
              <tr>
                <th>{dt("Пицца", "Pizza")}</th>
                {matrix.heads.map((h) => <th key={h} className="r">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.type}>
                  <td><b>{dt(...PIZZA[r.type])}</b></td>
                  {r.cells.map((c, i) =>
                    !c ? <td key={i} className="r muted">—</td> : (
                      <td key={i} className={`r ${c.price === r.best ? "best" : ""}`}>
                        {eur(c.price)}
                        <br />
                        <span className="small">
                          {c.cm
                            ? `${Math.round(c.cm)} ${dt("см", "cm")} · €${c.per100 === null ? "—" : dec(c.per100, 2, ru)} / 100 ${dt("см²", "cm²")}`
                            : dt("размер не указан", "size not given")}
                        </span>
                        <br />
                        <span className="small">{c.item}</span>
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {basket.length > 0 && (
        <div className="panel scroll">
          <table>
            <thead>
              <tr>
                <th>{dt("Корзина: каприччоза ~30 см", "Basket: capricciosa ~30 cm")}</th>
                <th className="r">{dt("1 пицца", "1 pizza")}</th>
                <th className="r">{dt("2 пиццы (с акцией)", "2 pizzas (with promo)")}</th>
                <th>{dt("Акция", "Promo")}</th>
              </tr>
            </thead>
            <tbody>
              {basket.map((b) => (
                <tr key={b.col}>
                  <td><b>{b.col}</b></td>
                  <td className={`r ${b.one === bestOne ? "best" : ""}`}>{eur(b.one)}</td>
                  <td className={`r ${b.two > 0 && b.two === bestTwo ? "best" : ""}`}>{b.two > 0 ? eur(b.two) : "—"}</td>
                  <td className="small">{b.promo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed.texts.prices_footer && <p className="small">{ed.texts.prices_footer}</p>}
    </>
  );
}
