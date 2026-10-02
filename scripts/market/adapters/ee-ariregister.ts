// Эстония: годовые отчёты из открытых данных ariregister (CC BY 4.0). Ссылки на файлы
// меняются вместе с датой выгрузки, поэтому берём их со страницы загрузки.
import { httpGet, zipLines } from "../lib.ts";
import { parseEeElements, parseEeReports } from "../registry.ts";
import type { Adapter } from "./types.ts";

const SITE = "https://avaandmed.ariregister.rik.ee";
const PAGE = `${SITE}/en/downloading-open-data`;
/** Сколько последних отчётных лет перечитываем: поздние подачи и исправления. */
const YEARS_BACK = 3;

export function findEeLinks(
  html: string,
): { reports: string | null; elements: Record<number, string> } {
  const hrefs = [...html.matchAll(/href="([^"]+\.zip)"/g)].map((
    m,
  ) => (m[1].startsWith("http") ? m[1] : SITE + m[1]));
  const elements: Record<number, string> = {};
  for (const h of hrefs) {
    const m = h.match(/4\.(\d{4})_aruannete_elemendid/);
    if (m) elements[Number(m[1])] = h;
  }
  return {
    reports: hrefs.find((h) => /1\.aruannete_yldandmed/.test(h)) ?? null,
    elements,
  };
}

export const eeAriregister: Adapter = {
  id: "ee-ariregister",
  about: {
    url: "https://avaandmed.ariregister.rik.ee",
    what:
      "годовые отчёты юрлиц Эстонии (открытые данные e-Äriregister): выручка и сотрудники по рег. коду из companies",
  },
  async collect(cfg) {
    const started_at = new Date().toISOString();
    const base = {
      country: cfg.country,
      started_at,
      source: "registry" as const,
      adapter: "ee-ariregister",
    };
    try {
      const links = findEeLinks(await (await httpGet(PAGE)).text());
      if (!links.reports) {
        throw new Error(
          "на странице ariregister нет файла общих данных отчётов",
        );
      }
      const regIds = new Set(cfg.companies.map((c) => c.regId));
      const lineArr: string[] = [];
      for await (const l of zipLines(links.reports)) {
        if (regIds.has(l.split(";")[2]?.replace(/"/g, ""))) lineArr.push(l);
      }
      const reports = parseEeReports(lineArr, regIds);
      const years = Object.keys(links.elements).map(Number).sort((a, b) =>
        b - a
      ).slice(0, YEARS_BACK);
      const out = [];
      for (const y of years) {
        const picked: string[] = [];
        for await (const l of zipLines(links.elements[y])) {
          if (reports.has(l.slice(0, l.indexOf(";")))) picked.push(l);
        }
        out.push(...parseEeElements(picked, reports));
      }
      return { ...base, years: out };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
