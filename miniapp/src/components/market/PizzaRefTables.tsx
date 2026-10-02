"use client";
// «Как работают сети» (#opT эталона) и «Оценки по точкам» (#rtT) — только из ручной части
// (editorial.ops_model, editorial.ratings); без неё куски не показываются.
import type { Editorial } from "@/lib/marketEditorial";
import { useDt, useLang } from "@/components/roy/nav";
import { dec, intFmt, Sw } from "./ref";

type Props = { ed: Editorial; color: (k: string) => string; name: (k: string) => string };

export function PizzaOpsModel({ ed, color, name }: Props) {
  const dt = useDt();
  const om = ed.opsModel;
  if (!om) return null;
  return (
    <>
      <div className="sec-head" style={{ marginTop: 12 }}><h3 style={{ fontSize: 16 }}>{dt("Как работают сети", "How the chains operate")}</h3></div>
      <div className="panel scroll">
        <table>
          <thead>
            <tr>
              <th />
              {om.chains.map((k) => <th key={k}><Sw color={color(k)} inline />{name(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {om.rows.map((r, i) => (
              <tr key={i}>
                <td><b>{r[0]}</b></td>
                {r.slice(1).map((c, j) => <td key={j}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Полоска оценки Google: шкала от 2,5 до 5, как в эталоне. */
const barWidth = (g: number) => `${Math.max(0, Math.min(100, ((g - 2.5) / 2.5) * 100))}%`;

export function PizzaRatings({ ed, color, name }: Props) {
  const dt = useDt();
  const ru = useLang() === "ru";
  if (!ed.ratings.length) return null;
  return (
    <>
      <div className="sec-head" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 16 }}>{ed.texts.ratings_title ?? dt("Оценки по точкам", "Ratings by location")}</h3>
        {ed.texts.ratings_note && <p className="small">{ed.texts.ratings_note}</p>}
      </div>
      <div className="panel scroll">
        <table>
          <thead>
            <tr>
              <th>{dt("Точка", "Location")}</th>
              <th>{dt("Город", "City")}</th>
              <th className="r">Google</th>
              <th className="r">{dt("Отзывов", "Reviews")}</th>
              <th />
              <th className="r">{dt("Wolt, из 10", "Wolt, of 10")}</th>
            </tr>
          </thead>
          <tbody>
            {ed.ratings.map((r) => (
              <tr key={`${r.chain}|${r.point}`}>
                <td style={{ whiteSpace: "nowrap" }}><Sw color={color(r.chain)} inline />{name(r.chain)} {r.point}</td>
                <td>{r.city}</td>
                <td className="r"><b>{dec(r.google, 1, ru)}</b></td>
                <td className="r">{r.reviews === null ? "—" : intFmt(r.reviews, ru)}</td>
                <td style={{ minWidth: 120 }}><div className="hbar" style={{ width: barWidth(r.google), background: color(r.chain) }} /></td>
                <td className="r">{r.wolt === null ? "—" : dec(r.wolt, 1, ru)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
