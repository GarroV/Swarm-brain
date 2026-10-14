// Болгария: чистые функции разбора годовых отчётов из Търговски регистър (адаптер
// adapters/bg-registry.ts). Тут нет сети и внешних программ — только текст → числа и правило
// достоверности; всё под тестами на синтетических фикстурах (bg-registry.test.ts).
//
// Правило достоверности (ядро): выручка года публикуется только подтверждённой —
//  (а) её прочитали из настоящего текстового слоя PDF (не распознавание), либо
//  (б) два независимых чтения сходятся в пределах 1%: колонка «текущий год» отчёта за Y и
//      колонка «предыдущий год» отчёта за Y+1.
// Значение, прочитанное распознаванием (OCR) без подтверждения, не публикуется.

/** Курс фиксирован при вводе евро: 1 EUR = 1,95583 BGN. */
export const BGN_PER_EUR = 1.95583;
/** Допуск совпадения двух чтений одного года. */
export const AGREE_TOLERANCE = 0.01;
export const MIN_YEAR = 2020;
/** Разбор «131 987 123 456» мог бы дать 131 987 123 и 456: годовой скачок выручки сети в разы
 *  невозможен, такие разборы отбрасываются, пока есть из чего выбирать. */
const MAX_YOY = 5;

export type Filing = { year: number; token: string };
export type Page = { text: string; ocr: boolean };
export type Candidate = { cur: number; prev: number };
/** Одно чтение отчёта. Кандидатов несколько, если строку можно разобрать по-разному
 *  (колонка «бележка» слипается с суммой: «14 123 456 91 234»). Суммы — в левах. */
export type Reading = {
  year: number;
  /** Год назван на самой странице отчёта; иначе это год из дела регистра (может быть чужим:
   *  у Pizza Lab и Aladin отчёт следующего года подан под прошлым). */
  yearKnown: boolean;
  candidates: Candidate[];
  ocr: boolean;
};
export type YearDecision = {
  year: number;
  revenueBgn: number | null;
  /** Почему года нет в публикации (или чем подтверждён, если есть). */
  reason: string;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
export const bgnToEur = (bgn: number): number => round2(bgn / BGN_PER_EUR);

// ---- Список отчётов дела ----

/** Все htmlData дела, где перечислены годовые отчёты. */
export function collectFilingHtml(deed: unknown): string[] {
  const out: string[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (
          k === "htmlData" && typeof v === "string" &&
          v.includes("Годишен финансов отчет")
        ) out.push(v);
        else walk(v);
      }
    }
  };
  walk(deed);
  return out;
}

/** «Година: 2021г. … DocumentAccess/<токен>» → пары год/токен (у года может быть несколько файлов). */
export function parseFilings(htmls: string[]): Filing[] {
  const out: Filing[] = [];
  for (const html of htmls) {
    for (const block of html.split(/(?=Година: \d{4})/)) {
      const y = block.match(/^Година: (\d{4})/);
      if (!y) continue;
      for (const m of block.matchAll(/href=['"]DocumentAccess\/([^'"]+)/g)) {
        out.push({ year: Number(y[1]), token: m[1] });
      }
    }
  }
  return out;
}

// ---- Читаемость страницы ----

/** Страница годна, если в ней достаточно букв и почти все они кириллица. Текстовый слой сканов
 *  бывает пустым, а у «текстовых» PDF — битым шрифтом («OT�ET 3A BCE06XBATHHff»), повёрнутые
 *  страницы после распознавания тоже рассыпаются в латиницу и мусор. */
export function isReadable(text: string): boolean {
  const cyr = (text.match(/[\u0400-\u04ff]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  return cyr >= MIN_CYRILLIC && cyr / (cyr + lat) >= MIN_CYRILLIC_SHARE;
}
const MIN_CYRILLIC = 40;
const MIN_CYRILLIC_SHARE = 0.7;
/** Из двух чтений страницы берём то, где больше кириллицы. */
export const cyrillicCount = (text: string): number =>
  (text.match(/[\u0400-\u04ff]/g) ?? []).length;

// ---- Числа ----

const isLead = (t: string) => /^\d{1,3}$/.test(t);
const isGroup = (t: string) => /^\d{3}$/.test(t);

/** «41 237» или «41237» → 41237; пустое/не число → null. */
function parseValue(tokens: string[]): number | null {
  if (!tokens.length) return null;
  if (tokens.length === 1) {
    return /^\d+$/.test(tokens[0]) ? Number(tokens[0]) : null;
  }
  if (!isLead(tokens[0]) || !tokens.slice(1).every(isGroup)) return null;
  return Number(tokens.join(""));
}

/** Делит токены на две колонки (текущий и прошлый год), пропустив skip токенов номера бележки. */
function splitColumns(tokens: string[], skip: number): Candidate[] {
  const rest = tokens.slice(skip);
  const out: Candidate[] = [];
  for (let k = 1; k < rest.length; k++) {
    const cur = parseValue(rest.slice(0, k));
    const prev = parseValue(rest.slice(k));
    if (cur !== null && prev !== null) out.push({ cur, prev });
  }
  return out;
}

/** Токены строки отчёта («бележка», текущий год, прошлый год) → все допустимые пары значений.
 *  hasNoteCol: true — колонка «бележка» есть, и первый короткий токен — её номер; false — нет;
 *  undefined — неизвестно, возвращаем оба разбора. */
export function parseColumns(
  tokens: string[],
  hasNoteCol?: boolean,
): Candidate[] {
  const withNote = /^\d{1,2}$/.test(tokens[0] ?? "")
    ? splitColumns(tokens, 1)
    : [];
  const noNote = splitColumns(tokens, 0);
  if (hasNoteCol === true) return dedupe(withNote.length ? withNote : noNote);
  if (hasNoteCol === false) return dedupe(noNote);
  return dedupe([...withNote, ...noNote]);
}

function dedupe(c: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return c.filter((x) => {
    const k = `${x.cur}/${x.prev}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- Отчёт о доходах ----

/** По убыванию точности. «Нетни приходи» без «от продажби» — вариант малых предприятий,
 *  «Приходи от договори с клиенти» и просто «Приходи» — строка отчёта по МСФО. Голое «Приходи»
 *  берём только на странице с заголовком отчёта (BARE_LABEL): иначе это любая таблица. */
const LABELS = [
  // «от» в распознанном тексте бывает «ст», «ot»: любое слово до трёх знаков.
  /^нетни\s+приходи\s+\S{1,3}\s+продажби/i,
  /^приходи\s+\S{1,3}\s+продажби/i,
  /^нетни\s+приходи/i,
  /^приходи\s+от\s+договори\s+с\s+клиенти/i,
  /^приходи(?=\s)/i,
  /^общо\s+приходи\s+от\s+договори\s+с\s+клиенти/i,
];
const BARE_LABEL = 4;
/** После названия строки: «, в т.ч.:» (как его читает OCR: «BT.4.»), единицы «(хил. лв.)». */
const LABEL_TAIL =
  /^[\s,.:;]*(?:[вВBb][\s.]*[тТTt][\s.]*[чЧ4][\s.:]*)?(?:\(?\s*(?:в\s+)?хил[^\d]*)?/i;
/** Отчёт группы — не выручка юрлица, на которое смотрит реестр. */
const CONSOLIDATED = /консолидиран/i;
const STATEMENT_HEAD =
  /отчет\s+за\s+(?:печалбата|приходите|всеобхватния|доходите)|всеобхватен\s+доход|приходите\s+и\s+разходите/i;
const THOUSANDS = /хил\.?\s*лв|хил\.?\s*лева|хиляди\s+лева|х\.\s*лв|в\s+хил/i;

/** Подготовка строки: разделители таблицы и тысяч («50.983», «41,237») → пробелы. */
function cleanLine(line: string): string {
  return line
    .replace(/[ |]/g, " ")
    .replace(/(?<=\d)[.,](?=\d{3}(?!\d))/g, " ")
    .replace(/^[\s.\-–•*]+/, "")
    .replace(/^(?:[IVX]+|\d+|[а-г])[.),]\s+/i, "");
}

/** Сама строка и её продолжения после «|»: у отчёта-таблицы расходы и приходы стоят в одной
 *  строке («… 4411|1. Нетни приходи от продажби … 13705 8102»). */
function withTails(line: string): string[] {
  const out = [line];
  for (let i = line.indexOf("|"); i >= 0; i = line.indexOf("|", i + 1)) {
    out.push(line.slice(i + 1));
  }
  return out;
}

/** Мусор распознавания между колонками («и», «“», «_») не токен таблицы; тире — токен (пусто). */
const isTableToken = (t: string): boolean =>
  t === "-" || t === "–" || /\d/.test(t) || t.length >= 3;

type Hit = {
  priority: number;
  hasHead: boolean;
  consolidated: boolean;
  pageIdx: number;
  tokens: string[];
  /** Годы из ближайшей шапки таблицы, затем из заголовка страницы. */
  header: number[];
  titleYear: number | null;
};

const NUMBER_ONLY = /^\(?\d[\d ]*\)?$/;

/** Повёрнутые страницы tesseract читает колонками: подпись строки, а суммы — отдельными строками
 *  ниже («1. Нетни приходи от продажби», пусто, «19 532», пусто, «13 705»). Берём две ближайшие. */
function numbersBelow(lines: string[], from: number): string[] {
  const found: string[] = [];
  for (let k = from + 1; k < Math.min(lines.length, from + 8); k++) {
    const t = lines[k].replace(/[\u00a0]/g, " ").trim();
    if (!t) continue;
    if (!NUMBER_ONLY.test(t)) break;
    found.push(t.replace(/[()]/g, ""));
    if (found.length === 2) return found.flatMap((f) => f.split(/\s+/));
  }
  return [];
}

function headerYears(lines: string[], li: number): number[] {
  // Ближайшая выше строка, где названы два года («31.12.2021 31.12.2020»).
  for (let k = li - 1; k >= Math.max(0, li - 30); k--) {
    const ys = [
      ...new Set(
        [...lines[k].matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1])),
      ),
    ];
    if (ys.length >= 2) return ys;
  }
  return [];
}

/** Год в заголовке страницы («ФИНАНСОВИ ОТЧЕТИ КЪМ 31 ДЕКЕМВРИ 2022»); только если он один. */
function titleYear(lines: string[]): number | null {
  const top = lines.filter((l) => l.trim()).slice(0, 4).join(" ");
  const ys = [
    ...new Set(
      [...top.matchAll(/(?:31\.12\.|декември\s+|към\s+)(20\d\d)/gi)].map((
        m,
      ) => Number(m[1])),
    ),
  ];
  return ys.length === 1 ? ys[0] : null;
}

function findHits(pages: Page[]): Hit[] {
  const hits: Hit[] = [];
  pages.forEach((pg, pageIdx) => {
    const lines = pg.text.split("\n");
    const top = lines.filter((l) => l.trim()).slice(0, 3).join(" ");
    const consolidated = CONSOLIDATED.test(top);
    const hasHead = STATEMENT_HEAD.test(pg.text);
    const tYear = titleYear(lines);
    lines.forEach((rawLine, li) => {
      for (const raw of withTails(rawLine)) {
        const line = cleanLine(raw);
        const priority = LABELS.findIndex((re) => re.test(line));
        if (priority < 0) continue;
        if (priority === BARE_LABEL && !hasHead) continue;
        const rest = line.replace(LABELS[priority], "").replace(LABEL_TAIL, "")
          .replace(/^[\s:,.-]+/, "");
        let tokens = rest.split(/\s+/).filter(isTableToken);
        if (!tokens.length) tokens = numbersBelow(lines, li);
        if (tokens.length < 2) continue;
        // Только числа: «Приходи от продажби на продукция …», «Нетни приходи (НП) …» — не итог.
        if (!tokens.every((t) => /^\(?\d+\)?$/.test(t))) continue;
        hits.push({
          consolidated,
          priority,
          hasHead,
          pageIdx,
          tokens: tokens.map((t) => t.replace(/[()]/g, "")),
          header: headerYears(lines, li),
          titleYear: tYear,
        });
      }
    });
  });
  return hits;
}

/** Читает «Приходи от продажби» из текста отчёта. filingYear — год из дела регистра; если шапка
 *  таблицы говорит иное («31.12.2020 / 31.12.2019»), верим шапке. null — строки итога нет. */
export function readIncomeStatement(
  pages: Page[],
  filingYear: number,
): Reading | null {
  const hits = findHits(pages).filter((h) => !h.consolidated);
  const pool = hits.some((h) => h.hasHead)
    ? hits.filter((h) => h.hasHead)
    : hits;
  const scale = pages.some((p) => THOUSANDS.test(p.text)) ? 1000 : 1;
  // Первая по точности подписи строка, из которой получились правдоподобные суммы.
  for (const hit of [...pool].sort((x, y) => x.priority - y.priority)) {
    // Колонка «бележка» в строке может быть пустой, поэтому разбор «с бележкой» и «без» держим
    // оба: лишний отсекают единицы (миллион) и правдоподобный годовой скачок, остальное — сверка.
    const scaled = parseColumns(hit.tokens)
      .map((c) => ({ cur: c.cur * scale, prev: c.prev * scale }))
      // Выручка сети в левах не бывает меньше миллиона: иначе единицы не опознаны.
      .filter((c) => c.cur >= 1_000_000);
    if (!scaled.length) continue;
    const sane = scaled.filter((c) =>
      c.cur / c.prev <= MAX_YOY && c.prev / c.cur <= MAX_YOY
    );
    const [a, b] = hit.header;
    const fromHeader = a !== undefined && b === a - 1 ? a : null;
    const year = fromHeader ?? hit.titleYear ?? filingYear;
    return {
      year,
      yearKnown: fromHeader !== null || hit.titleYear !== null,
      candidates: sane.length ? sane : scaled,
      ocr: pages[hit.pageIdx].ocr,
    };
  }
  return null;
}

// ---- Правило достоверности ----

export const agree = (a: number, b: number): boolean =>
  Math.abs(a - b) <= AGREE_TOLERANCE * Math.max(a, b);

/** Самое частое точное значение среди чтений; при равенстве — fallback (сравнительная колонка отчёта следующего года: её сверстали позже).
 *  Распознанная цифра может отличаться от верной на единицу, и в пределах допуска два чтения всё
 *  равно «сходятся»: голосование по всем файлам года и следующего года выбирает то, что прочли чаще. */
function mostCommon(values: number[], fallback: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = fallback;
  for (const [v, n] of count) {
    if (n > (count.get(best) ?? 0)) best = v;
  }
  return best;
}

/** Отчёт, у которого год не назван на странице, получает его из цепочки: его «прошлый год» —
 *  это «текущий» отчёта с известным годом, значит он на год моложе. Однозначно или никак. */
function resolveYears(readings: Reading[]): Reading[] {
  return readings.map((r) => {
    if (r.yearKnown) return r;
    const years = new Set(
      readings.filter((o) =>
        o.yearKnown &&
        o.candidates.some((oc) =>
          r.candidates.some((c) => agree(c.prev, oc.cur))
        )
      ).map((o) => o.year + 1),
    );
    return years.size === 1
      ? { ...r, year: [...years][0], yearKnown: true }
      : r;
  });
}

/** Решение по каждому году ≥ MIN_YEAR, который встречается среди отчётов. */
export function decideYears(all: Reading[]): YearDecision[] {
  const readings = resolveYears(all);
  const years = [
    ...new Set(readings.map((r) => r.year).filter((y) => y >= MIN_YEAR)),
  ].sort((a, b) => a - b);
  return years.map((year): YearDecision => {
    const own = readings.filter((r) => r.year === year);
    const next = readings.filter((r) => r.year === year + 1);
    // (б) независимое подтверждение: «текущий» года Y против «прошлого» отчёта Y+1.
    const nextPrev = next.flatMap((n) => n.candidates.map((c) => c.prev));
    const ownCur = own.flatMap((r) => r.candidates.map((c) => c.cur));
    const confirmed = ownCur.find((v) => nextPrev.some((p) => agree(v, p)));
    if (confirmed !== undefined) {
      return {
        year,
        revenueBgn: mostCommon(
          [...ownCur, ...nextPrev].filter((v) => agree(v, confirmed)),
          nextPrev.find((v) => agree(v, confirmed)) ?? confirmed,
        ),
        reason: "подтверждён отчётом следующего года",
      };
    }
    // (а) настоящий текстовый слой, разбор однозначен.
    const text = [
      ...new Set(
        own.filter((r) => !r.ocr && r.yearKnown && r.candidates.length === 1)
          .map((r) => r.candidates[0].cur),
      ),
    ];
    if (text.length === 1) {
      return { year, revenueBgn: text[0], reason: "текстовый слой PDF" };
    }
    if (text.length > 1) {
      return {
        year,
        revenueBgn: null,
        reason: `текстовые слои расходятся: ${text.join(" / ")}`,
      };
    }
    if (!own.length) {
      return {
        year,
        revenueBgn: null,
        reason: "в отчёте года не нашли выручку",
      };
    }
    return {
      year,
      revenueBgn: null,
      reason: next.length
        ? "распознано OCR, отчёт следующего года не сошёлся"
        : "распознано OCR, отчёта следующего года для проверки нет",
    };
  });
}
