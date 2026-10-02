"use client";
import { useEffect, useState } from "react";
import { Segmented } from "@/components/roy/ui";
import { useDt } from "@/components/roy/nav";
import { fetchModelUsage, type ModelUsage, type UsageSlice } from "@/lib/api";

// «Расход модели» в админке (issue #311, владелец 02.10.2026: «заведи это все в админскую
// панель»). Данные — GET /admin/model-usage (только суперадмин). Вызовы модели без цены в сумму
// не входят и показаны отдельно: сумма не должна прятать то, что посчитать нечем.

type Period = 7 | 30 | 90;
const PERIODS: Period[] = [7, 30, 90];

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
  const [days, setDays] = useState<Period>(30);
  const [data, setData] = useState<ModelUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchModelUsage(days).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [days]);

  const purposeName = (key: string) => {
    const l = PURPOSE_LABEL[key];
    return l ? dt(l[0], l[1]) : key;
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-[220px]">
          <Segmented
            items={PERIODS.map((p) => ({ id: String(p), label: dt(`${p} дн.`, `${p} d`) }))}
            value={String(days)}
            onChange={(id) => setDays(Number(id) as Period)}
          />
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
          <Days rows={data.by_day} />
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

function Days({ rows }: { rows: ModelUsage["by_day"] }) {
  const dt = useDt();
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.usd), 0.000001);
  return (
    <section>
      <h3 className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("По дням", "By day")}</h3>
      <div className="flex h-[90px] items-end gap-[3px]" role="img" aria-label={dt("Расход по дням", "Spend by day")}>
        {rows.map((r) => (
          <div key={r.day} title={`${r.day}: ${usd(r.usd)} · ${r.calls}`}
            className="min-w-[4px] flex-1 rounded-t-[3px] bg-primary/70"
            style={{ height: `${Math.max(2, (r.usd / max) * 100)}%` }} />
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
