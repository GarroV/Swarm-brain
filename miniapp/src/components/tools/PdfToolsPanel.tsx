"use client";
import { useState } from "react";
import { useDt } from "@/components/roy/nav";

// PDF-инструменты прямо в рабочей области «Полезностей» (решение владельца 03.10.2026: «встроить в
// рабочую область… не отдельным окном»; набор инструментов — «пдф давай добьем», issue #794).
// Каждый инструмент — страница отдельного приложения (GarroV/swarm-pdf, форк BentoPDF) в iframe;
// адрес разрешён в frame-src (scripts/gen-csp-headers.mjs). Движки инструментов (cpdf,
// Ghostscript, PyMuPDF) форк раздаёт сам, без чужих CDN (swarm-pdf: swarm/build.sh).
//
// Открытый однажды инструмент остаётся смонтированным и при переключении только прячется, как и
// вся панель при сворачивании плитки (ToolsDesk): состояние iframe другого сайта отсюда не
// прочитать и не сохранить, поэтому переключение не должно уничтожать несохранённую работу.

export const PDF_APP_URL = "https://swarm-pdf.pages.dev";

type PdfTool = { slug: string; label: [string, string] };

const PDF_TOOLS: PdfTool[] = [
  { slug: "edit-pdf-text", label: ["Править текст", "Edit text"] },
  { slug: "merge-pdf", label: ["Склеить", "Merge"] },
  { slug: "split-pdf", label: ["Разрезать", "Split"] },
  { slug: "compress-pdf", label: ["Сжать", "Compress"] },
  { slug: "organize-pdf", label: ["Страницы", "Pages"] },
  { slug: "rotate-pdf", label: ["Повернуть", "Rotate"] },
  { slug: "sign-pdf", label: ["Подписать", "Sign"] },
  { slug: "image-to-pdf", label: ["Картинки → PDF", "Images → PDF"] },
  { slug: "pdf-to-png", label: ["PDF → картинки", "PDF → images"] },
  { slug: "pdf-to-word", label: ["PDF → Word", "PDF → Word"] },
];

// `?embed=1` — инструмент прячет обвязку своего сайта (шапку, «к инструментам», подвал):
// внутри Swarm она лишняя и уводит со страницы (swarm-pdf: src/js/logic/swarm-embed.ts).
const toolUrl = (slug: string) => `${PDF_APP_URL}/${slug}?embed=1`;

export function PdfToolsPanel() {
  const dt = useDt();
  const [active, setActive] = useState(PDF_TOOLS[0].slug);
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set([PDF_TOOLS[0].slug]));

  const pick = (slug: string) => {
    setActive(slug);
    setMounted((prev) => (prev.has(slug) ? prev : new Set(prev).add(slug)));
  };

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label={dt("PDF-инструменты", "PDF tools")}
        className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-2">
        {PDF_TOOLS.map((t) => (
          <button key={t.slug} type="button" role="tab" aria-selected={t.slug === active} onClick={() => pick(t.slug)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 ${t.slug === active ? "border-ink bg-ink text-surface" : "border-line text-ink hover:border-line-2"}`}
            style={{ fontSize: 13 }}>
            {dt(t.label[0], t.label[1])}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-ink-soft" style={{ fontSize: 12 }}>
        <span>{dt("Файлы не покидают браузер. Сохраните результат, прежде чем уйти со страницы", "Files never leave your browser. Save the result before leaving the page")}</span>
        <a href={`${PDF_APP_URL}/${active}`} target="_blank" rel="noopener noreferrer" className="ml-auto hover:text-ink">
          {dt("Открыть в новой вкладке", "Open in a new tab")}
        </a>
      </div>
      {PDF_TOOLS.filter((t) => mounted.has(t.slug)).map((t) => (
        <iframe key={t.slug} hidden={t.slug !== active}
          src={toolUrl(t.slug)}
          aria-label={dt(t.label[0], t.label[1])}
          allow="clipboard-read; clipboard-write; local-fonts"
          className="h-[calc(100dvh-260px)] min-h-[560px] w-full rounded-b-[12px] border-0 border-t border-line bg-white"
        />
      ))}
    </div>
  );
}
