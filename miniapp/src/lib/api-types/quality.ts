// ── Баллы РС и РКО по пиццериям (GET /quality — прокси к API Децимуса) ──────────
export type QualityKind = "rs" | "rko";

export interface QualityPeriod {
  start: string; // ГГГГ-ММ-ДД: РС — 1-е или 16-е число, РКО — понедельник
  end: string;
}

export interface QualityUnit {
  id: string; // id пиццерии Dodo IS, 32 hex
  name: string;
  cc: string;
  developer: string | null;
  /** Выровнены по `periods`; null — в этот период балла нет. */
  scores: (number | null)[];
}

export interface QualityData {
  kind: QualityKind;
  periods: QualityPeriod[]; // по возрастанию
  units: QualityUnit[];
}

export interface InspectionPrev {
  id: string;
  date: string;
  score_pct: number;
  grade: string | null;
}

export interface Inspection {
  id: string;
  unit: { id: string; dodo_id: string | null; name: string; cc: string };
  date: string;
  kind: string | null;
  score_pct: number;
  grade: string | null;
  path: string;
  /** Ссылка на отчёт в Децимусе, собирает сервер; null — адрес Децимуса не настроен. */
  report_url: string | null;
  previous: InspectionPrev | null;
}

export interface InspectionsData {
  inspections: Inspection[];
  truncated: boolean;
}

/** Зона как её хранит движок Децимуса: доля, потеря и остаток — в процентных пунктах общей оценки. */
export interface InspectionZone {
  zone: string;
  title_ru: string | null;
  title_en: string | null;
  share: number | null;
  loss: number | null;
  left: number | null;
  zeroed: boolean;
}

export interface InspectionFinding {
  n: number;
  code: string;
  title_ru: string | null;
  title_en: string | null;
  level: string;
  zone: string;
  text: string | null;
  repeat: boolean;
}

export interface InspectionDetail {
  inspection: Inspection & {
    deductions: number;
    counts: Record<string, number>;
    zones: InspectionZone[];
  };
  findings: InspectionFinding[];
}
