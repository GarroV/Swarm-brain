// Лист «Качество по пиццериям» таблиц «Аналитика IMF» (РС) и «Аналитика IMF (РКО)», выгрузка
// «Файл → Скачать → CSV». Перенос разбора из Децимуса (src/ratings/sheet.py, решения D317–D334
// там же), логика та же:
//   · над данными — служебные строки («Кол-во пиццерий», «Месяц»); заголовок — первая из первых
//     HEADER_WINDOW строк, где правее четырёх колонок стоят подписи периодов ОДНОГО типа;
//   · первые четыре колонки — по месту: девелопер, страна, пиццерия, ссылка на рейтинг (из неё id);
//   · девелопер и страна стоят в первой строке объединённого блока и тянутся вниз;
//   · РС — полумесяцы («Сентябрь 2»: часть 1 с 1-го, часть 2 с 16-го), РКО — недели
//     («05.05 — 11.05»); года в подписях нет, его выводит assignYears.
// Ядро: баллы отсюда показываются как факт, поэтому всё под тестами (sheet.test.ts).

import { qualityCountryCode } from "./countries.ts";

export type QualityKind = "rs" | "rko";
export const KIND_TITLE: Record<QualityKind, string> = { rs: "РС", rko: "РКО" };

export class QualityFormatError extends Error {}

const FIXED_COLUMNS = 4;
/** Сколько первых строк просматривать в поисках подписей периодов. */
const HEADER_WINDOW = 10;
/** «Нет оценки»: пусто или прочерк любой длины. */
const NO_SCORE = new Set(["", "-", "–", "—"]);
/** Строка «Девелопер, Страна, Пиццерия» под подписями периодов. */
const HEADER_COUNTRY = new Set(["страна", "country"]);
const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
// «Март-1» встречается наравне с «Март 1» — разделитель пробел или дефис.
const RS_LABEL = /^([а-яё]+)\s*[-–—]?\s*([12])(?:\s+часть)?(?:\s+(\d{4}))?$/iu;
const RKO_LABEL = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*[—–-]\s*(\d{1,2})\.(\d{1,2})(?:\.\d{4})?$/;
const RATING_LINK = /^https?:\/\/dodopizza\.info\/rating#\/([0-9a-fA-F-]{32,36})(?:\/(\d))?/;
/** Тип рейтинга в пути ссылки: 1 — РКО, 2 — РС. */
const LINK_KIND: Record<string, QualityKind> = { "1": "rko", "2": "rs" };

/** Подпись периода без года. d2 = 0 — последний день месяца (вторая часть РС), считается от года. */
export type Label = { kind: QualityKind; m1: number; d1: number; m2: number; d2: number; year: number | null };
export type Period = { start: string; end: string; label: string };
export type ScoreRow = {
  unit_id: string;
  unit_name: string;
  country_code: string;
  developer: string | null;
  period_start: string;
  period_end: string;
  score: number;
};
export type SheetUnit = { id: string; name: string; cc: string };
export type CellKey = { unit_id: string; period_start: string };
export type ParsedSheet = {
  kind: QualityKind;
  /** По возрастанию, как колонки листа. */
  periods: Period[];
  scores: ScoreRow[];
  /** Ячейки с не-баллом: запись не трогает то, что по ним уже лежит в базе. */
  badCells: CellKey[];
  issues: string[];
  units: number;
  /** Все пиццерии листа, включая те, у которых в этой выгрузке ни одного балла. */
  sheetUnits: SheetUnit[];
  countries: string[];
};

const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** CSV по RFC 4180: кавычки, запятые и переводы строк внутри ячейки, удвоенная кавычка. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) rows.push([...row, cell]);
  return rows;
}

export function parseLabel(text: string): Label | null {
  const clean = squash(text);
  const rs = clean.match(RS_LABEL);
  if (rs) {
    const month = MONTHS_RU.indexOf(rs[1].toLowerCase()) + 1;
    if (!month) return null;
    const first = rs[2] === "1";
    return { kind: "rs", m1: month, d1: first ? 1 : 16, m2: month, d2: first ? 15 : 0, year: rs[3] ? +rs[3] : null };
  }
  const rko = clean.match(RKO_LABEL);
  if (rko) {
    const [d1, m1, d2, m2] = [rko[1], rko[2], rko[4], rko[5]].map(Number);
    if (!(m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31)) return null;
    return { kind: "rko", m1, d1, m2, d2, year: rko[3] ? +rko[3] : null };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number, label: string): string {
  const day = d || new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
    throw new QualityFormatError(
      `Дата периода в заголовке листа не существует: «${label}» (${pad(day)}.${pad(m)}.${y})`,
    );
  }
  return `${y}-${pad(m)}-${pad(day)}`;
}

function period(l: Label, year: number): Period {
  const text = l.kind === "rs"
    ? `${MONTHS_RU[l.m1 - 1]} ${l.d1 === 1 ? 1 : 2}`
    : `${pad(l.d1)}.${pad(l.m1)} — ${pad(l.d2)}.${pad(l.m2)}`;
  // Неделя через Новый год («29.12 — 04.01») кончается в следующем году.
  const wraps = l.kind === "rko" && l.m2 * 100 + l.d2 < l.m1 * 100 + l.d1;
  return {
    start: isoDate(year, l.m1, l.d1, text),
    end: isoDate(wraps ? year + 1 : year, l.m2, l.d2, text),
    label: `${text} ${year}`,
  };
}

/** Год к подписи: колонки идут по времени, последняя — не позже `today` (ГГГГ-ММ-ДД). Справа
 *  налево год уменьшается, когда начало периода «прыгает» вперёд (декабрь левее января).
 *  Подпись с годом задаёт год сама. */
export function assignYears(labels: Label[], today: string): Period[] {
  const [ty, tm, td] = today.split("-").map(Number);
  const key = (m: number, d: number) => m * 100 + d;
  let year = ty;
  let later: number | null = null;
  const out: Period[] = [];
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    const start = key(l.m1, l.d1);
    if (l.year !== null) year = l.year;
    else if (later === null) {
      if (start > key(tm, td)) year -= 1;
    } else if (start > later) year -= 1;
    later = start;
    out.push(period(l, year));
  }
  return out.reverse();
}

function headerKind(cells: string[]): QualityKind | null {
  const kinds = new Set(
    cells.slice(FIXED_COLUMNS).filter((c) => c.trim()).map(parseLabel).filter((l): l is Label => l !== null).map((l) =>
      l.kind
    ),
  );
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** Балл ячейки: число 0–100 (запятая или точка, «%» допустим), прочерк/пусто — null. */
export function parseScore(cell: string): number | null {
  const clean = cell.trim().replace(/%$/, "").trim().replace(",", ".");
  if (NO_SCORE.has(clean)) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(clean)) throw new Error(`«${cell.trim()}» не число`);
  const value = Number(clean);
  if (value < 0 || value > 100) throw new Error(`балл ${value} вне 0–100`);
  return value;
}

const isNumber = (cell: string) => {
  try {
    return parseScore(cell) !== null;
  } catch {
    return false;
  }
};

type Column = { index: number; name: string; period: Period };

function periodColumns(head: string[], today: string, issues: string[]): Column[] {
  const labelled = head.map((name, index) => ({ index, name, label: index >= FIXED_COLUMNS ? parseLabel(name) : null }))
    .filter((c): c is { index: number; name: string; label: Label } => c.label !== null);
  const periods = assignYears(labelled.map((c) => c.label), today);
  // Две колонки с одной датой начала — опечатка в подписи: склеить значило бы молча затереть одни
  // баллы другими, поэтому берётся левая, правая уходит в замечания.
  const first = new Map<string, string>();
  const out: Column[] = [];
  labelled.forEach((c, i) => {
    const p = periods[i];
    const seen = first.get(p.start);
    if (seen !== undefined) {
      issues.push(`колонка «${squash(c.name)}» начинается тем же днём, что «${seen}», — пропущена, проверьте подпись`);
      return;
    }
    first.set(p.start, squash(c.name));
    out.push({ index: c.index, name: squash(c.name), period: p });
  });
  return out;
}

/** Колонка без подписи периода, но с числами — потерянные баллы, их надо увидеть. Дубль
 *  «Пиццерия» (имена) пропускается тихо. */
function strayColumns(head: string[], body: string[][], issues: string[]): void {
  for (let i = FIXED_COLUMNS; i < head.length; i++) {
    if (parseLabel(head[i]) !== null) continue;
    if (body.some((cells) => i < cells.length && isNumber(cells[i]))) {
      issues.push(`колонка «${squash(head[i]) || `№${i + 1}`}» не подписана периодом — пропущена`);
    }
  }
}

function unitIdFromLink(raw: string): { id: string; kind: QualityKind | null } | null {
  const m = raw.trim().match(RATING_LINK);
  if (!m) return null;
  const id = m[1].replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  return { id, kind: m[2] ? LINK_KIND[m[2]] ?? null : null };
}

export function parseQualitySheet(csv: string, opts: { today: string; kind?: QualityKind }): ParsedSheet {
  const table = parseCsv(csv);
  const at = table.slice(0, HEADER_WINDOW).findIndex((cells) => headerKind(cells) !== null);
  if (at < 0) {
    throw new QualityFormatError(
      `Это не лист «Качество по пиццериям»: в первых ${HEADER_WINDOW} строках нет строки с периодами рейтинга ` +
        "одного типа (РС «Сентябрь 2» или РКО «05.05 — 11.05») правее четырёх колонок девелопер, страна, пиццерия, ссылка",
    );
  }
  const head = table[at];
  const kind = headerKind(head)!;
  if (opts.kind && opts.kind !== kind) {
    throw new QualityFormatError(
      `Просили загрузить ${KIND_TITLE[opts.kind]}, а в листе периоды ${KIND_TITLE[kind]}: проверьте, тот ли файл`,
    );
  }
  const issues: string[] = [];
  const columns = periodColumns(head, opts.today, issues);
  const body = table.slice(at + 1).map((cells, i) => ({ rowNo: at + 2 + i, cells }));
  strayColumns(head, body.map((r) => r.cells), issues);
  return { kind, periods: columns.map((c) => c.period), ...parseBody(body, columns, kind, issues), issues };
}

function parseBody(
  body: { rowNo: number; cells: string[] }[],
  columns: Column[],
  kind: QualityKind,
  issues: string[],
): Pick<ParsedSheet, "scores" | "badCells" | "units" | "sheetUnits" | "countries"> {
  const scores: ScoreRow[] = [];
  const badCells: CellKey[] = [];
  const seen = new Set<string>();
  const sheetUnits: SheetUnit[] = [];
  const countries = new Set<string>();
  let developer = "";
  let countryRaw = "";
  for (const { rowNo, cells: raw } of body) {
    const cell = (i: number) => (raw[i] ?? "").trim();
    if (HEADER_COUNTRY.has(cell(1).toLowerCase())) continue;
    if (raw.every((c) => !c.trim())) continue;
    developer = squash(cell(0)) || developer;
    countryRaw = squash(cell(1)) || countryRaw;
    const name = squash(cell(2));
    const at = `строка ${rowNo}${name ? ` (${name})` : ""}`;
    const cc = qualityCountryCode(countryRaw);
    if (cc === null) {
      issues.push(`${at}: страна «${countryRaw}» не узнана — строка пропущена`);
      continue;
    }
    if (!name) {
      issues.push(`${at}: нет имени пиццерии — строка пропущена`);
      continue;
    }
    const unit = unitIdFromLink(cell(3));
    if (!unit) {
      // Без id пиццерию не к чему привязать. Пустая строка без баллов ничего не теряет — молча мимо.
      const lost = columns.filter((c) => isNumber(raw[c.index] ?? "")).length;
      if (lost) issues.push(`${at}: нет ссылки на рейтинг с id пиццерии — не загружено баллов: ${lost}`);
      continue;
    }
    if (unit.kind && unit.kind !== kind) {
      issues.push(`${at}: ссылка ведёт на ${KIND_TITLE[unit.kind]}, а лист — ${KIND_TITLE[kind]}`);
    }
    if (seen.has(unit.id)) {
      issues.push(`${at}: пиццерия с этим id уже была выше — строка пропущена`);
      continue;
    }
    seen.add(unit.id);
    sheetUnits.push({ id: unit.id, name, cc });
    countries.add(cc);
    const bad: string[] = [];
    for (const col of columns) {
      try {
        const score = parseScore(raw[col.index] ?? "");
        if (score === null) continue;
        scores.push({
          unit_id: unit.id,
          unit_name: name,
          country_code: cc,
          developer: developer || null,
          period_start: col.period.start,
          period_end: col.period.end,
          score,
        });
      } catch (e) {
        bad.push(`${col.name}: ${(e as Error).message}`);
        badCells.push({ unit_id: unit.id, period_start: col.period.start });
      }
    }
    if (bad.length) issues.push(`${at}: не балл — ${bad.join("; ")}`);
  }
  return { scores, badCells, units: seen.size, sheetUnits, countries: [...countries].sort() };
}
