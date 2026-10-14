// Болгария: годовые отчёты из Търговски регистър (portal.registryagency.bg, бесплатно, без входа).
// Дело юрлица → список «Годишен финансов отчет» → PDF → строка «Приходи от продажби» отчёта о
// доходах. Большинство PDF — сканы, поэтому страницы без текстового слоя распознаёт tesseract
// (bul+eng). Что именно публикуется, решает bg-registry.ts: подтверждённая выручка, лев → евро
// по фиксированному курсу. Прибыль не отправляем (на экране её нигде нет — правило владельца).
// Нужны программы poppler (pdftotext, pdftoppm) и tesseract с языком bul — в CI ставит market-collect.yml.
import {
  bgnToEur,
  collectFilingHtml,
  cyrillicCount,
  decideYears,
  isReadable,
  MIN_YEAR,
  type Page,
  parseFilings,
  readIncomeStatement,
  type Reading,
} from "../bg-registry.ts";
import type { RegistryYear } from "../../../supabase/functions/market-ingest/types.ts";
import type { Adapter } from "./types.ts";

const API = "https://portal.registryagency.bg/CR/api";
const SOURCE_URL = "https://portal.registryagency.bg/CR";
const TIMEOUT_MS = 90_000;
const RETRIES = 3;
const BACKOFF_MS = [5_000, 20_000, 60_000];
/** Пауза между запросами к реестру: ходим по одному и не торопимся. */
const POLITE_MS = 1_500;
const OCR_WORKERS = 4;
// Accept-Language обязателен: Deno по умолчанию шлёт «*», и реестр отвечает на это HTTP 500.
const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept-Language": "bg,en;q=0.8",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url: string, accept?: string): Promise<Response> {
  let last = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? 60_000);
    try {
      const r = await fetch(url, {
        headers: accept ? { ...HEADERS, Accept: accept } : HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return r;
      await r.body?.cancel();
      last = `HTTP ${r.status}`;
      // 4xx, кроме «слишком часто» и «таймаут», повтором не лечится.
      if (r.status < 500 && r.status !== 429 && r.status !== 408) break;
    } catch (e) {
      last = String(e);
    }
  }
  throw new Error(`${url.slice(0, 100)} → ${last}`);
}

async function run(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command(cmd, {
    args,
    env,
    stdout: "piped",
    stderr: "null",
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}

/** Режимы разметки tesseract: 4 держит строку таблицы целой («Приходи 60 405 41 237»); 1 сам
 *  определяет поворот — для страниц, которые после режима 4 рассыпались (повёрнутые отчёты). */
const PSM_PRIMARY = 4;
const PSM_ROTATED = 1;

async function ocrPage(png: string, psm: number): Promise<string> {
  const o = await run(
    "tesseract",
    [png, "-", "-l", "bul+eng", "--psm", String(psm)],
    { OMP_THREAD_LIMIT: "1" },
  );
  if (!o.ok) throw new Error(`tesseract не распознал ${png}`);
  return o.out;
}

/** PDF → страницы текста: настоящий текстовый слой оставляем, страницы без него (сканы, битый
 *  шрифт) читает tesseract. */
async function pdfPages(pdf: Uint8Array): Promise<Page[]> {
  const dir = await Deno.makeTempDir({ prefix: "bg-registry-" });
  try {
    const file = `${dir}/doc.pdf`;
    await Deno.writeFile(file, pdf);
    const t = await run("pdftotext", ["-layout", file, "-"]);
    if (!t.ok) throw new Error("pdftotext не прочитал файл");
    const raw = t.out.split("\f");
    if (raw.length && !raw[raw.length - 1].trim()) raw.pop();
    const pages: Page[] = raw.map((text) => ({ text, ocr: false }));
    const scans = pages.flatMap((p, i) => isReadable(p.text) ? [] : [i]);
    let next = 0;
    const worker = async () => {
      while (next < scans.length) {
        const i = scans[next++];
        const base = `${dir}/p${i + 1}`;
        const png = `${base}.png`;
        await run("pdftoppm", [
          "-r",
          "300",
          "-gray",
          "-png",
          "-f",
          String(i + 1),
          "-l",
          String(i + 1),
          "-singlefile",
          file,
          base,
        ]);
        let text = await ocrPage(png, PSM_PRIMARY);
        if (!isReadable(text)) {
          const rotated = await ocrPage(png, PSM_ROTATED);
          if (cyrillicCount(rotated) > cyrillicCount(text)) text = rotated;
        }
        pages[i] = { text, ocr: true };
        await Deno.remove(png).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: OCR_WORKERS }, worker));
    return pages;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** Чтения всех отчётов компании за годы ≥ MIN_YEAR. Сбой одного файла не роняет остальные. */
async function readCompany(eik: string): Promise<Reading[]> {
  const deed = await (await fetchRetry(
    `${API}/Deeds/${eik}`,
    "application/json",
  )).json();
  const filings = parseFilings(collectFilingHtml(deed)).filter((f) =>
    f.year >= MIN_YEAR
  );
  const readings: Reading[] = [];
  const doneYears = new Set<number>();
  for (const f of filings) {
    // По году бывает несколько файлов (отчёт, приложения): текстовое чтение их не требует.
    if (doneYears.has(f.year)) continue;
    await sleep(POLITE_MS);
    try {
      const pdf = new Uint8Array(
        await (await fetchRetry(`${API}/Documents/${f.token}`)).arrayBuffer(),
      );
      const rd = readIncomeStatement(await pdfPages(pdf), f.year);
      if (rd) {
        readings.push(rd);
        if (!rd.ocr && rd.candidates.length === 1) doneYears.add(f.year);
      }
    } catch (e) {
      console.warn(`BG ${eik} ${f.year}: файл пропущен — ${e}`);
    }
  }
  return readings;
}

export const bgRegistry: Adapter = {
  id: "bg-registry",
  about: {
    url: "https://portal.registryagency.bg (Търговски регистър)",
    what:
      "годовые финансовые отчёты юрлиц Болгарии по ЕИК из companies: выручка («Приходи от продажби»), PDF-сканы распознаёт tesseract; публикуется только подтверждённое (текстовый слой или сходится с отчётом следующего года); лев → евро по фиксированному курсу 1,95583",
  },
  async collect(cfg) {
    const base = {
      country: cfg.country,
      started_at: new Date().toISOString(),
      source: "registry" as const,
      adapter: "bg-registry",
    };
    try {
      const out: RegistryYear[] = [];
      const errors: string[] = [];
      for (const c of cfg.companies) {
        try {
          const readings = await readCompany(c.regId);
          for (const d of decideYears(readings)) {
            if (d.revenueBgn === null) {
              console.warn(
                `BG ${c.regId} ${d.year}: не публикуем — ${d.reason}`,
              );
              continue;
            }
            out.push({
              reg_id: c.regId,
              year: d.year,
              revenue_eur: bgnToEur(d.revenueBgn),
              net_profit_eur: null,
              employees: null,
              source:
                `${SOURCE_URL} (Търговски регистър, ЕИК ${c.regId}, годишен финансов отчет ${d.year}; ${d.revenueBgn} лв.)`,
            });
          }
        } catch (e) {
          errors.push(`${c.regId}: ${e}`);
        }
      }
      // Сбой всех компаний — это сбой источника; частичный — оставляем найденное, но шумим.
      if (errors.length && !out.length) throw new Error(errors.join("; "));
      for (const e of errors) console.warn(`BG ${e}`);
      return { ...base, years: out };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
