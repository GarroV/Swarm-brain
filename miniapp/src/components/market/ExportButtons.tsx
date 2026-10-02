"use client";
// Выгрузка раздела одним файлом, как эталон: HTML (снимок экрана со стилями раздела, карта —
// картинкой) и PDF (тот же HTML, распечатанный браузером из скрытой рамки). Интерактив снимка
// не переносится: подсказки, зум карты и сортировка остаются только в Swarm.
import { useState } from "react";
import { useDt } from "@/components/roy/nav";

/** Шрифты эталона — той же ссылкой, что в хорватском отчёте; без сети файл падает на системный шрифт. */
const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
/** Печать: раскладка десктопа (PRINT_W) сжата в ширину листа A4 — иначе широкие таблицы режутся
 *  справа; фон и цвета как на экране, блоки не рвутся, прокрутка таблиц раскрыта, переключатели
 *  карты (год, режим) не печатаются — в файле они не работают. */
const PRINT_W = 1160; // px; 190 мм печатной ширины A4 ≈ 718 px → масштаб 0,62
const PRINT_CSS = `@page{size:A4;margin:10mm}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mkt .mkt-wrap{width:${PRINT_W}px;max-width:none;zoom:${(718 / PRINT_W).toFixed(2)};padding:0;gap:24px}
.mkt .panel,.mkt .kpi,.mkt .cc,.mkt .chartbox,.mkt header{break-inside:avoid}
.mkt .scroll{overflow:visible!important}.mkt .seg{display:none}
.mkt table td{white-space:normal!important;overflow-wrap:anywhere}}`; // реестр на экране держит строки в одну линию и листается — на бумаге переносим

/** Правила стилей, нужные снимку: всё под .mkt, переменные тем (:root, .dark) и любое правило,
 *  которое срабатывает хоть на одном элементе снимка (утилиты Tailwind в «Источниках»). Группы
 *  (@media, @layer, @supports) сохраняются с отобранными правилами внутри. */
function pickRules(rules: CSSRuleList, scope: Element): string[] {
  const out: string[] = [];
  for (const r of Array.from(rules)) {
    if (r instanceof CSSFontFaceRule) continue;
    if (r instanceof CSSStyleRule) {
      const sel = r.selectorText;
      let hit = sel.includes(".mkt") || /(^|,)\s*(:root|html|\.dark)\b/.test(sel);
      if (!hit) {
        try {
          hit = !!scope.querySelector(sel);
        } catch {
          hit = false; // селектор, который движок не разбирает вне листа
        }
      }
      if (hit) out.push(r.cssText);
    } else if ("cssRules" in r) {
      const inner = pickRules((r as CSSGroupingRule).cssRules, scope);
      if (inner.length) out.push(`${r.cssText.slice(0, r.cssText.indexOf("{"))}{\n${inner.join("\n")}\n}`);
    } else if (r instanceof CSSPropertyRule || r.cssText.startsWith("@layer")) {
      out.push(r.cssText); // @property и порядок слоёв Tailwind
    }
  }
  return out;
}

function sectionCss(scope: Element): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      out.push(...pickRules(sheet.cssRules, scope));
    } catch {
      continue; // чужой лист без CORS — в разделе таких нет
    }
  }
  return out.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Самостоятельный HTML текущего экрана раздела. */
function snapshot(title: string): string {
  const root = document.querySelector<HTMLElement>(".mkt");
  const wrap = root?.querySelector<HTMLElement>(".mkt-wrap");
  if (!root || !wrap) throw new Error("market section is not on screen");
  const clone = wrap.cloneNode(true) as HTMLElement;
  // Холсты не копируются содержимым — подменяем картинкой текущего кадра.
  const live = wrap.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((c, i) => {
    const src = live[i];
    const img = document.createElement("img");
    img.src = src.toDataURL("image/png");
    img.style.cssText = src.style.cssText || "width:100%";
    img.alt = "";
    c.replaceWith(img);
  });
  clone.querySelectorAll("[data-export='skip'], .tip, input, select").forEach((e) => e.remove());
  // Правила отбираются по снимку внутри обёртки .mkt — как он будет стоять в файле.
  const holder = document.createElement("div");
  holder.className = "mkt";
  holder.append(clone);
  const dark = document.documentElement.classList.contains("dark");
  const lang = document.documentElement.lang || "ru";
  return `<!doctype html>
<html lang="${esc(lang)}"${dark ? ' class="dark"' : ""}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="${FONTS}">
<style>body{margin:0}.mkt{--font-mkt:"Inter";--font-mkt-mono:"JetBrains Mono"}
${sectionCss(holder)}
${PRINT_CSS}</style></head>
<body>${holder.outerHTML}</body></html>`;
}

function download(html: string, file: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** PDF — печать снимка из скрытой рамки: системный диалог «Сохранить как PDF», без библиотек. */
function printHtml(html: string) {
  const frame = Object.assign(document.createElement("iframe"), { srcdoc: html });
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1240px;height:0;border:0;visibility:hidden";
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    // Шрифты эталона грузятся по сети — ждём их, иначе первая страница уходит системным шрифтом.
    w.document.fonts.ready.then(() => {
      w.addEventListener("afterprint", () => frame.remove(), { once: true });
      w.focus();
      w.print();
    });
  };
  document.body.append(frame);
}

export function ExportButtons({ country, name }: { country: string; name: string }) {
  const dt = useDt();
  const [failed, setFailed] = useState(false);
  const title = dt(`Рынок QSR · ${name}`, `QSR market · ${name}`);
  const file = `market-${country}-${new Date().toISOString().slice(0, 10)}`;
  const run = (kind: "html" | "pdf") => {
    try {
      const html = snapshot(title);
      if (kind === "html") download(html, `${file}.html`);
      else printHtml(html);
      setFailed(false);
    } catch (e) {
      console.error("market export failed", e);
      setFailed(true);
    }
  };
  return (
    <div className="seg" data-export="skip" role="group" aria-label={dt("Скачать", "Download")}>
      <button type="button" onClick={() => run("html")}>{dt("Скачать HTML", "Download HTML")}</button>
      <button type="button" onClick={() => run("pdf")}>{dt("Скачать PDF", "Download PDF")}</button>
      {failed && <span className="small" role="alert">{dt("Не получилось собрать файл.", "Could not build the file.")}</span>}
    </div>
  );
}
