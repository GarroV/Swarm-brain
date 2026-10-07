"use client";
import { useEffect, useMemo, useState } from "react";
import { RangePicker } from "@/components/ui/RangePicker";
import { useDt, useLang } from "@/components/roy/nav";
import { fetchModelUsage, type ModelUsage, type UsageCall } from "@/lib/api";
import { presetRange, type DateRange } from "@/lib/dateRange";
import { fmtShort } from "@/lib/calendar";
import { shiftRange, type UsageGrain } from "@/lib/usageBuckets";
import { matches, OTHER, usageView, type CubeSlice, type UsageFilter } from "@/lib/usageCube";
import { ModelUsageChart, usd } from "./ModelUsageChart";

// «Расход модели» в админке (issue #311, владелец 02.10.2026: «заведи это все в админскую
// панель»). Данные — GET /admin/model-usage (только суперадмин). Вызовы модели без цены в сумму
// не входят и показаны отдельно: сумма не должна прятать то, что посчитать нечем.
// #822 (07.10.2026: «чтобы можно было четко понимать когда где какой расход»): период один на
// экран — календарь «с — по» и стрелки ← →, по умолчанию текущий месяц. Щелчок по строке «На что»
// или «Модели» фильтрует весь экран; щелчок по столбцу графика сужает период до него. Внизу —
// журнал последних вызовов: когда, на что, какая встреча, сколько.

const PURPOSE_LABEL: Record<string, [string, string]> = {
  "meeting:transcription": ["Транскрибация встреч", "Meeting transcription"],
  "meeting:tezisy": ["Тезисы встреч", "Meeting notes"],
  "meeting:title": ["Заголовки встреч", "Meeting titles"],
  "meeting:rebuild": ["Переработка тезисов", "Notes rebuild"],
  "meeting:ask": ["Вопросы по встрече", "Questions about a meeting"],
  "unlabeled": ["Без подписи", "Unlabeled"],
  [OTHER]: ["Прочее", "Other"],
};

/** Сколько строк журнала показываем сразу и сколько добавляет «Показать ещё». */
const JOURNAL_PAGE = 30;
const NO_FILTER: UsageFilter = { purpose: null, model: null };

const TIME_FMT = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" });

export function ModelUsagePanel() {
  const dt = useDt();
  const lang = useLang();
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [grain, setGrain] = useState<UsageGrain>("day");
  const [filter, setFilter] = useState<UsageFilter>(NO_FILTER);
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

  const view = useMemo(
    () => (data?.cells ? usageView(data.cells, data.from, data.to, grain, filter) : null),
    [data, grain, filter],
  );

  const purposeName = (key: string) => {
    const l = PURPOSE_LABEL[key];
    return l ? dt(l[0], l[1]) : key;
  };
  const title = (id: string | null) =>
    id === null ? "—" : (data?.meeting_titles?.[id] ?? dt("Без названия", "Untitled"));
  const toggle = (key: keyof UsageFilter, value: string) =>
    setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));

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

      {(filter.purpose || filter.model) && (
        <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
          <span className="text-ink-mute">{dt("Фильтр:", "Filter:")}</span>
          {filter.purpose && <Chip label={purposeName(filter.purpose)} onClear={() => toggle("purpose", filter.purpose!)} />}
          {filter.model && <Chip label={filter.model} onClear={() => toggle("model", filter.model!)} />}
        </div>
      )}

      {error && <p role="alert" className="text-destructive" style={{ fontSize: 13 }}>{error}</p>}
      {!data && !error && <div className="roy-shim" style={{ height: 120, borderRadius: 10 }} />}
      {data && !view && (
        <p className="text-ink-mute" style={{ fontSize: 13 }}>
          {dt("Сервер ещё обновляется — откройте экран через пару минут.", "The server is still updating — reopen this screen in a couple of minutes.")}
        </p>
      )}

      {data && view && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={dt("Потрачено", "Spent")} value={usd(view.total_usd)} />
            <Stat label={dt("В среднем за день", "Average per day")} value={usd(view.avg_per_day)} />
            <Stat label={dt("Самый дорогой день", "Most expensive day")}
              value={view.peak_day ? usd(view.peak_day.usd) : "—"}
              hint={view.peak_day ? (fmtShort(view.peak_day.day, lang) ?? view.peak_day.day) : undefined} />
            <Stat label={dt("Вызовов", "Calls")} value={view.calls.toLocaleString()} />
            <Stat label={dt("Аудио, мин", "Audio, min")} value={view.audio_minutes.toLocaleString()} />
            <Stat
              label={dt("Без цены", "Unpriced")}
              value={view.unpriced_calls.toLocaleString()}
              hint={view.unpriced_calls > 0 ? dt("модель не в прайсе — в сумму не вошли", "model not priced — not in the total") : undefined}
            />
          </div>
          {data.truncated && (
            <p className="text-ink-mute" style={{ fontSize: 12 }}>
              {dt("Строк больше лимита — показана часть периода.", "Too many rows — only part of the period is shown.")}
            </p>
          )}
          <ModelUsageChart buckets={view.buckets} series={view.series} seriesName={purposeName} grain={grain} onGrain={setGrain}
            onPick={(b) => {
              if (b.start === data.from && b.end === data.to) return;
              setRange({ preset: "custom", from: b.start, to: b.end });
              setGrain("day");
            }} />
          <p className="text-ink-mute" style={{ fontSize: 12 }}>
            {dt("Щелчок по строке ниже — отфильтровать весь экран.", "Click a row below to filter the whole screen.")}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <SliceTable title={dt("На что", "What for")} rows={view.by_purpose} name={purposeName}
              active={filter.purpose} onPick={(k) => toggle("purpose", k)} />
            <SliceTable title={dt("Модели", "Models")} rows={view.by_model} name={(k) => k}
              active={filter.model} onPick={(k) => toggle("model", k)} />
          </div>
          <section>
            <h3 className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("Самые дорогие встречи", "Most expensive meetings")}</h3>
            {view.top_meetings.length === 0
              ? <p className="text-ink-mute" style={{ fontSize: 12.5 }}>{dt("Встреч в учёте нет", "No meetings tracked")}</p>
              : view.top_meetings.map((m) => (
                <div key={m.meeting_id} className="flex items-center justify-between gap-3 border-b border-line py-1.5" style={{ fontSize: 13 }}>
                  <span className="truncate text-ink">{title(m.meeting_id)}</span>
                  <span className="shrink-0 font-mono text-ink-soft">{usd(m.usd)} · {m.calls}</span>
                </div>
              ))}
          </section>
          <Journal calls={(data.recent ?? []).filter((c) => matches(c, filter))} purposeName={purposeName} title={title} />
        </>
      )}
    </div>
  );
}

function Journal({ calls, purposeName, title }: {
  calls: UsageCall[]; purposeName: (k: string) => string; title: (id: string | null) => string;
}) {
  const dt = useDt();
  const lang = useLang();
  const [shown, setShown] = useState(JOURNAL_PAGE);
  return (
    <section>
      <h3 className="mb-0.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("Последние вызовы", "Recent calls")}</h3>
      <p className="mb-1.5 text-ink-mute" style={{ fontSize: 12 }}>
        {dt("До 300 последних вызовов периода, время по Белграду.", "Up to 300 latest calls of the period, Belgrade time.")}
      </p>
      {calls.length === 0 && <p className="text-ink-mute" style={{ fontSize: 12.5 }}>{dt("Вызовов нет", "No calls")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: 12.5 }}>
          <tbody>
            {calls.slice(0, shown).map((c, i) => (
              <tr key={`${c.at}-${i}`} className="border-b border-line">
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-ink-mute">
                  {fmtShort(DAY_FMT.format(new Date(c.at)), lang)} {TIME_FMT.format(new Date(c.at))}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-ink">{purposeName(c.purpose)}</td>
                <td className="max-w-[260px] truncate py-1.5 pr-3 text-ink-soft">{title(c.meeting_id)}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-ink-mute">{c.model}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-mono text-ink-soft">{c.usd === null ? "?" : usd(c.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {calls.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + JOURNAL_PAGE)}
          className="mt-2 text-primary hover:underline" style={{ fontSize: 12.5 }}>
          {dt("Показать ещё", "Show more")} ({calls.length - shown})
        </button>
      )}
    </section>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const dt = useDt();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-surface-2 px-2.5 py-0.5 text-ink">
      {label}
      <button type="button" onClick={onClear} aria-label={dt("Снять фильтр", "Clear filter")} className="text-ink-mute hover:text-ink">✕</button>
    </span>
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

function SliceTable({ title, rows, name, active, onPick }: {
  title: string; rows: CubeSlice[]; name: (key: string) => string; active: string | null; onPick: (key: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold text-ink" style={{ fontSize: 13.5 }}>{title}</h3>
      {rows.map((r) => (
        <button key={r.key} type="button" onClick={() => onPick(r.key)} aria-pressed={active === r.key}
          className={`flex w-full items-center justify-between gap-3 border-b border-line px-1 py-1.5 text-left hover:bg-surface-2 ${active === r.key ? "bg-surface-2" : ""}`}
          style={{ fontSize: 13 }}>
          <span className="truncate text-ink">{name(r.key)}</span>
          <span className="shrink-0 font-mono text-ink-soft">
            {usd(r.usd)}{r.unpriced > 0 ? ` +${r.unpriced}?` : ""} · {r.calls}
          </span>
        </button>
      ))}
    </section>
  );
}
