"use client";
import type { ReactNode } from "react";
import { useDt } from "../nav";
import { Delta, Stat, TONE_TEXT, card } from "./QualityWidgets";
import { FILL, FILL_NOTE } from "./blockFill";
import { useMaps } from "./useMaps";
import { countryName } from "@/lib/countries";
import { MAPS_LOW, mapsSummary, type MapsTotal } from "@/lib/homeMaps";
import type { MapsStat, MapsUnit } from "@/lib/api";

// Вкладка «Карты» блока «Рейтинги»: оценка Google/Яндекс по выбранным странам против среднего по IMF
// (всем странам ответа, как «IMF» у РКО). Источник — GET /quality/maps; истории нет, только «сегодня против
// 30 дней назад», поэтому линейного графика нет.

const NAMES_MAX = 3;
const note = `rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute ${FILL_NOTE}`;
const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(2));

/** Названия пиццерий в подписи плашки, если их немного; иначе только число. */
const names = (list: MapsUnit[], none: string) =>
  list.length === 0 ? none : list.length <= NAMES_MAX ? list.map((u) => u.name).join(", ") : undefined;

export function MapsTab({ codes }: { codes: string[] }) {
  const dt = useDt();
  const { data, loading, failed, retry } = useMaps();
  if (loading) return <div className={`roy-shim ${FILL}`} style={{ height: 220, borderRadius: 12 }} />;
  if (failed || !data) {
    return (
      <div className={note} style={{ fontSize: 13 }}>
        {dt("Оценки карт не загрузились.", "Couldn't load map ratings.")}{" "}
        <button type="button" onClick={retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  const s = mapsSummary(data, codes);
  if (!s.rows.length) return <div className={note} style={{ fontSize: 13 }}>{dt("В выбранных странах оценок карт нет", "No map ratings in the selected countries")}</div>;
  const none = dt("нет", "none");
  const imfNote = (t: MapsTotal) => `IMF ${fmt(t.avg)}`;
  return (
    <div className={card}>
      <div>
        <div className="mt-1 font-mono font-semibold leading-none text-ink" style={{ fontSize: 46, letterSpacing: "-0.03em" }}>
          {fmt(s.google.avg)}<small className="ml-1 font-medium text-ink-mute" style={{ fontSize: 15 }}>/5</small>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
          <span className="text-ink-mute">Google</span>
          <Delta v={s.google.delta} digits={2} /> <span className="text-ink-mute">{dt("к 30 дням назад", "vs 30 days ago")}</span>
          <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{imfNote(s.imf.google)}</span>
          <Delta v={s.imf.google.delta} digits={2} small />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-4">
        <Stat label={dt("Google, среднее", "Google average")} value={<>{fmt(s.google.avg)} <Delta v={s.google.delta} digits={2} small /></>}
          note={`${imfNote(s.imf.google)} · ${dt(`${s.google.reviews} отз.`, `${s.google.reviews} reviews`)}`} />
        {s.hasYandex && (
          <Stat label={dt("Яндекс, среднее", "Yandex average")} value={<>{fmt(s.yandex.avg)} <Delta v={s.yandex.delta} digits={2} small /></>}
            note={`${imfNote(s.imf.yandex)} · ${dt(`${s.yandex.reviews} отз.`, `${s.yandex.reviews} reviews`)}`} />
        )}
        <Stat label={dt(`Google ниже ${MAPS_LOW}`, `Google below ${MAPS_LOW}`)} value={s.low.length}
          cls={TONE_TEXT[s.low.length ? "bad" : "good"]} note={names(s.low, none)} />
        <Stat label={dt("Без отзывов", "No reviews")} value={s.noReviews.length}
          cls={TONE_TEXT[s.noReviews.length ? "warn" : "good"]} note={names(s.noReviews, none)} />
      </div>
      <div className="flex flex-col" style={{ fontSize: 12.5 }}>
        <Row head cells={[dt("Страна", "Country"), "Google", dt("Яндекс", "Yandex")]} />
        {s.rows.map((c) => (
          <Row key={c.cc} cells={[dt(countryName(c.cc), c.cc), <Cell key="g" m={c.maps.google} />, <Cell key="y" m={c.maps.yandex} />]} />
        ))}
      </div>
    </div>
  );
}

function Cell({ m }: { m: MapsStat }) {
  return <span className="whitespace-nowrap">{fmt(m.avg)} <Delta v={m.delta} digits={2} small /></span>;
}

function Row({ cells, head }: { cells: ReactNode[]; head?: boolean }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,auto)] items-center gap-x-4 border-t border-line py-1.5 first:border-t-0 ${head ? "text-ink-mute" : "text-ink"}`}
      style={head ? { fontSize: 11 } : undefined}>
      {cells.map((c, i) => <span key={i} className={`min-w-0 truncate ${i ? "text-right font-mono" : ""}`}>{c}</span>)}
    </div>
  );
}
