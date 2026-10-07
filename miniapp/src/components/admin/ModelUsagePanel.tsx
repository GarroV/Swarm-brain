"use client";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/roy/ui";
import { RangePicker } from "@/components/ui/RangePicker";
import { useDt, useLang } from "@/components/roy/nav";
import { fetchModelUsage, type ModelUsage, type UsageSlice } from "@/lib/api";
import { presetRange, type DateRange } from "@/lib/dateRange";
import { bucketLabel, bucketUsage, shiftRange, type UsageGrain } from "@/lib/usageBuckets";

// «Расход модели» в админке (issue #311, владелец 02.10.2026: «заведи это все в админскую
// панель»). Данные — GET /admin/model-usage (только суперадмин). Вызовы модели без цены в сумму
// не входят и показаны отдельно: сумма не должна прятать то, что посчитать нечем.
// Период — один на экран (#822): календарь «с — по» и стрелки ← →, по умолчанию текущий месяц;
// все блоки показывают его. Шаг графика — день / неделя / месяц.

const GRAINS: Array<[UsageGrain, string, string]> = [["day", "День", "Day"], ["week", "Неделя", "Week"], ["month", "Месяц", "Month"]];

const PURPOSE_LABEL: Record<string, [string, string]> = {
  "meeting:transcription": ["Транскрибация встреч", "Meeting transcription"],
  "meeting:tezisy": ["Тезисы встреч", "Meeting notes"],
  "meeting:title": ["Заголовки встреч", "Meeting titles"],
  "meeting:rebuild": ["Переработка тезисов", "Notes rebuild"],
  "meeting:ask": ["Вопросы по встрече", "Questions about a meeting"],
  "unlabeled": ["Без подписи", "Unlabeled"],
};

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

export function ModelUsagePanel() {
  const dt = useDt();
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [grain, setGrain] = useState<UsageGrain>("day");
  const [data, setData] = useState<ModelUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchModelUsage(range.from, range.to)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [range.from, range.to]);

  const purposeName = (key: string) => {
    const l = PURPOSE_LABEL[key];
    return l ? dt(l[0], l[1]) : key;
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <StepButton dir={-1} onClick={() => setRange((r) => shiftRange(r, -1))} />
          <RangePicker variant="toolbar" value={range} onChange={(r) => setRange(r ?? presetRange("month"))} />
          <StepButton dir={1} onClick={() => setRange((r) => shiftRange(r, 1))} />
        </div>
        <span className="text-ink-mute" style={{ fontSize: 12 }}>
          {dt("Учёт ведётся с раскатки #311 — раньше расход не записывался", "Tracked since #311 shipped — earlier spend was not recorded")}
        </span>
      </div>

      {error && <p role="alert" className="text-destructive" style={{ fontSize: 13 }}>{error}</p>}
      {!data && !error && <div className="roy-shim" style={{ height: 120, borderRadius: 10 }} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label={dt("Потрачено", "Spent")} value={usd(data.total_usd)} />
            <Stat label={dt("Вызовов", "Calls")} value={data.calls.toLocaleString()} />
            <Stat label={dt("Аудио, мин", "Audio, min")} value={data.audio_minutes.toLocaleString()} />
            <Stat
              label={dt("Без цены", "Unpriced")}
              value={data.unpriced_calls.toLocaleString()}
              hint={data.unpriced_calls > 0 ? dt("модель не в прайсе — в сумму не вошли", "model not priced — not in the total") : undefined}
            />
          </div>
          {data.truncated && (
            <p className="text-ink-mute" style={{ fontSize: 12 }}>
              {dt("Строк больше лимита — показана часть периода.", "Too many rows — only part of the period is shown.")}
            </p>
          )}
          <Chart rows={data.by_day} from={data.from} to={data.to} grain={grain} onGrain={setGrain} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SliceTable title={dt("На что", "What for")} rows={data.by_purpose} name={purposeName} />
            <SliceTable title={dt("Модели", "Models")} rows={data.by_model} name={(k) => k} />
          </div>
          <section>
            <h3 className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("Самые дорогие встречи", "Most expensive meetings")}</h3>
            {data.top_meetings.length === 0
              ? <p className="text-ink-mute" style={{ fontSize: 12.5 }}>{dt("Встреч в учёте пока нет", "No meetings tracked yet")}</p>
              : data.top_meetings.map((m) => (
                <div key={m.meeting_id} className="flex items-center justify-between gap-3 border-b border-line py-1.5" style={{ fontSize: 13 }}>
                  <span className="truncate text-ink">{m.title ?? dt("Без названия", "Untitled")}</span>
                  <span className="shrink-0 font-mono text-ink-soft">{usd(m.usd)} · {m.calls}</span>
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <div className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>{label}</div>
      <div className="mt-0.5 font-semibold text-ink" style={{ fontSize: 18 }}>{value}</div>
      {hint && <div className="text-ink-mute" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

function StepButton({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  const dt = useDt();
  return (
    <button type="button" onClick={onClick}
      aria-label={dir < 0 ? dt("Предыдущий период", "Previous period") : dt("Следующий период", "Next period")}
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-2 bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink">
      {dir < 0 ? "←" : "→"}
    </button>
  );
}

/** Сколько подписей помещается под осью: остальные столбцы без подписи, чтобы текст не налезал. */
const MAX_LABELS = 8;

function Chart({ rows, from, to, grain, onGrain }: {
  rows: ModelUsage["by_day"]; from: string; to: string; grain: UsageGrain; onGrain: (g: UsageGrain) => void;
}) {
  const dt = useDt();
  const lang = useLang();
  const buckets = useMemo(() => bucketUsage(rows, from, to, grain), [rows, from, to, grain]);
  const max = Math.max(...buckets.map((b) => b.usd), 0.000001);
  const every = Math.max(1, Math.ceil(buckets.length / MAX_LABELS));
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("Расход по времени", "Spend over time")}</h3>
        <div className="w-[210px]">
          <Segmented items={GRAINS.map(([id, ru, en]) => ({ id, label: dt(ru, en) }))} value={grain} onChange={(id) => onGrain(id as UsageGrain)} />
        </div>
      </div>
      <div className="flex h-[90px] items-end gap-[3px]" role="img" aria-label={dt("Расход по времени", "Spend over time")}>
        {buckets.map((b) => (
          <div key={b.start} title={`${bucketLabel(b, grain, lang)}: ${usd(b.usd)} · ${b.calls}`}
            className="min-w-[4px] flex-1 rounded-t-[3px] bg-primary/70"
            style={{ height: b.usd > 0 ? `${Math.max(2, (b.usd / max) * 100)}%` : "1px" }} />
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-ink-mute" style={{ fontSize: 10.5 }}>
        {buckets.map((b, i) => (
          <div key={b.start} className="min-w-[4px] flex-1 overflow-visible whitespace-nowrap">
            {i % every === 0 ? bucketLabel(b, grain, lang) : ""}
          </div>
        ))}
      </div>
    </section>
  );
}

function SliceTable({ title, rows, name }: { title: string; rows: UsageSlice[]; name: (key: string) => string }) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{title}</h3>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3 border-b border-line py-1.5" style={{ fontSize: 13 }}>
          <span className="truncate text-ink">{name(r.key)}</span>
          <span className="shrink-0 font-mono text-ink-soft">
            {usd(r.usd)}{r.unpriced > 0 ? ` +${r.unpriced}?` : ""} · {r.calls}
          </span>
        </div>
      ))}
    </section>
  );
}
