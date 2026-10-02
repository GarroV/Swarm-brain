// Сводка расхода OpenAI для админки (issue #311). Чистая функция над строками `model_usage`:
// итог, разрезы по назначению, модели, дню (по Белграду) и самые дорогие встречи. Вызовы без цены
// (модель не в прайсе `model-usage.ts`) в сумму не входят и считаются отдельно — сумма их не прячет.

export interface UsageRow {
  created_at: string;
  kind: string;
  model: string | null;
  purpose: string;
  meeting_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  audio_seconds: number | null;
  cost_usd: number | null;
}

export interface Slice {
  key: string;
  usd: number;
  calls: number;
  unpriced: number;
  tokens: number;
}

export interface UsageSummary {
  total_usd: number;
  calls: number;
  unpriced_calls: number;
  tokens: number;
  audio_minutes: number;
  by_purpose: Slice[];
  by_model: Slice[];
  by_day: Array<{ day: string; usd: number; calls: number }>;
  top_meetings: Array<{ meeting_id: string; usd: number; calls: number }>;
}

export const TOP_MEETINGS = 10;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function addTo(map: Map<string, Slice>, key: string, r: UsageRow, tokens: number) {
  const s = map.get(key) ?? { key, usd: 0, calls: 0, unpriced: 0, tokens: 0 };
  map.set(key, {
    key,
    usd: s.usd + (r.cost_usd ?? 0),
    calls: s.calls + 1,
    unpriced: s.unpriced + (r.cost_usd === null ? 1 : 0),
    tokens: s.tokens + tokens,
  });
}

const bySpend = (a: Slice, b: Slice) => b.usd - a.usd || b.calls - a.calls;
const finish = (m: Map<string, Slice>) => [...m.values()].map((s) => ({ ...s, usd: round6(s.usd) })).sort(bySpend);

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  const purposes = new Map<string, Slice>();
  const models = new Map<string, Slice>();
  const days = new Map<string, { usd: number; calls: number }>();
  const meetings = new Map<string, { usd: number; calls: number }>();
  let total = 0, unpriced = 0, tokens = 0, audioSec = 0;

  for (const r of rows) {
    const t = (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
    const cost = r.cost_usd === null ? 0 : Number(r.cost_usd);
    const rr = { ...r, cost_usd: r.cost_usd === null ? null : cost };
    total += cost;
    tokens += t;
    audioSec += Number(r.audio_seconds ?? 0);
    if (r.cost_usd === null) unpriced++;
    addTo(purposes, r.purpose, rr, t);
    addTo(models, r.model ?? "—", rr, t);
    const day = DAY_FMT.format(new Date(r.created_at));
    const d = days.get(day) ?? { usd: 0, calls: 0 };
    days.set(day, { usd: d.usd + cost, calls: d.calls + 1 });
    if (r.meeting_id) {
      const m = meetings.get(r.meeting_id) ?? { usd: 0, calls: 0 };
      meetings.set(r.meeting_id, { usd: m.usd + cost, calls: m.calls + 1 });
    }
  }

  return {
    total_usd: round6(total),
    calls: rows.length,
    unpriced_calls: unpriced,
    tokens,
    audio_minutes: Math.round((audioSec / 60) * 10) / 10,
    by_purpose: finish(purposes),
    by_model: finish(models),
    by_day: [...days.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, usd: round6(v.usd), calls: v.calls })),
    top_meetings: [...meetings.entries()]
      .map(([meeting_id, v]) => ({ meeting_id, usd: round6(v.usd), calls: v.calls }))
      .sort((a, b) => b.usd - a.usd).slice(0, TOP_MEETINGS),
  };
}
