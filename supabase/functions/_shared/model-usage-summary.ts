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

/** День вызова по Белграду, «YYYY-MM-DD» — по нему режутся и график, и период. */
export const usageDay = (createdAt: string) => DAY_FMT.format(new Date(createdAt));

/** Самый длинный период, который отдаём за раз (#822): год с запасом на високосный. */
export const MAX_PERIOD_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function dayMs(day: string): number | null {
  if (!ISO_DAY.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  // 2026-02-31 Date.parse молча превращает в 3 марта — такой день не принимаем.
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day ? null : ms;
}

/**
 * Период из запроса: дни по Белграду, обе границы включительно (#822). Строкой — текст ошибки
 * для 400. `since`/`until` — окно выборки из базы с запасом в сутки с каждой стороны (Белград
 * от UTC отстоит на час-два); точную границу держит `inPeriod` по дню Белграда.
 */
export function parsePeriod(
  from: string | null,
  to: string | null,
): { from: string; to: string; since: string; until: string } | string {
  if (from === null || to === null) return "from and to are required (YYYY-MM-DD)";
  const a = dayMs(from), b = dayMs(to);
  if (a === null || b === null) return "from and to must be dates YYYY-MM-DD";
  if (a > b) return "from must not be after to";
  if ((b - a) / DAY_MS + 1 > MAX_PERIOD_DAYS) return `period must not exceed ${MAX_PERIOD_DAYS} days`;
  return {
    from,
    to,
    since: new Date(a - DAY_MS).toISOString(),
    until: new Date(b + 2 * DAY_MS).toISOString(),
  };
}

/** Строка попадает в период по своему дню в Белграде. */
export const inPeriod = (createdAt: string, p: { from: string; to: string }) => {
  const d = usageDay(createdAt);
  return d >= p.from && d <= p.to;
};

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
    const day = usageDay(r.created_at);
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
