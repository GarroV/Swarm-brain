// Строки quality_scores → ответ GET /quality: периоды по возрастанию и пиццерии с баллами,
// выровненными по периодам (null — в этот период балла нет). Чистая функция под тестом.
import type { QualityKind } from "./sheet.ts";

export type StoredScore = {
  unit_id: string;
  unit_name: string;
  country_code: string;
  developer: string | null;
  period_start: string;
  period_end: string;
  score: number | string;
};

export type QualityView = {
  kind: QualityKind;
  periods: { start: string; end: string }[];
  units: { id: string; name: string; cc: string; developer: string | null; scores: (number | null)[] }[];
};

export function buildQualityView(kind: QualityKind, rows: StoredScore[]): QualityView {
  const ends = new Map<string, string>();
  for (const r of rows) ends.set(r.period_start, r.period_end);
  const starts = [...ends.keys()].sort();
  const index = new Map(starts.map((s, i) => [s, i]));
  // Имя, страна и девелопер — по самому свежему периоду пиццерии: переименование в листе
  // не должно оставлять на экране старое имя.
  const units = new Map<string, { latest: string; head: StoredScore; scores: (number | null)[] }>();
  for (const r of rows) {
    const u = units.get(r.unit_id) ?? { latest: "", head: r, scores: starts.map(() => null) };
    if (r.period_start >= u.latest) {
      u.latest = r.period_start;
      u.head = r;
    }
    u.scores[index.get(r.period_start)!] = Number(r.score);
    units.set(r.unit_id, u);
  }
  return {
    kind,
    periods: starts.map((start) => ({ start, end: ends.get(start)! })),
    units: [...units.entries()]
      .map(([id, u]) => ({
        id,
        name: u.head.unit_name,
        cc: u.head.country_code.trim(),
        developer: u.head.developer,
        scores: u.scores,
      }))
      .sort((a, b) => a.cc.localeCompare(b.cc) || a.name.localeCompare(b.name)),
  };
}
