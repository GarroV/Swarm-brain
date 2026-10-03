"use client";
import { Fragment, useState } from "react";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";
import type { RoyIconName } from "@/lib/royIcons";
import { ShortLinkTool } from "./ShortLinkTool";
import { PdfEditorPanel } from "./PdfEditorPanel";

// «Полезности» (решение владельца 2026-10-02): плитки небольших сервисов. Новый сервис = запись в
// TOOLS + его компонент в TOOL_BODY. Плитки ведут себя как проекты на доске (решение владельца
// 03.10.2026: «чтобы они не пропадали вникуда, а как бы окошко разворачивалось и остальные
// сдвигались»): свёрнутая — плитка фиксированной ширины, раскрытая — на всю строку на своём месте,
// остальные съезжают ниже; щелчок по шапке сворачивает. Раскрытых может быть несколько.

type ToolId = "shortLinks" | "pdfEditor";

// PDF-редактор — форк BentoPDF (GarroV/swarm-pdf), Cloudflare Pages; файлы не покидают браузер.
export const PDF_EDITOR_URL = "https://swarm-pdf.pages.dev/edit-pdf-text";

type Tool = { id: ToolId; icon: RoyIconName; title: [string, string]; text: [string, string] };

const TOOLS: Tool[] = [
  {
    id: "shortLinks",
    icon: "link",
    title: ["Короткие ссылки", "Short links"],
    text: ["Длинная ссылка → короткая, для SMS и сообщений", "Long link → short one, for SMS and messages"],
  },
  {
    id: "pdfEditor",
    icon: "pdf",
    title: ["PDF-редактор", "PDF editor"],
    text: [
      "Править текст прямо в PDF. Файл обрабатывается в браузере и никуда не загружается",
      "Edit text right in a PDF. The file is processed in your browser and never uploaded",
    ],
  },
];

const TOOL_BODY: Record<ToolId, () => React.ReactNode> = {
  shortLinks: () => <ShortLinkTool />,
  pdfEditor: () => <PdfEditorPanel url={PDF_EDITOR_URL} />,
};

const TILE_CLASS =
  "flex w-56 shrink-0 flex-col items-start gap-2 self-start rounded-[12px] border border-line bg-surface p-4 text-left transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.98] max-[520px]:w-full";

export function ToolsDesk() {
  const dt = useDt();
  // expanded — что раскрыто сейчас; mounted — что хоть раз открывали. Открытый однажды сервис
  // остаётся смонтированным и при сворачивании только прячется: так PDF-редактор не теряет
  // несохранённую правку (см. PdfEditorPanel).
  const [expanded, setExpanded] = useState<ReadonlySet<ToolId>>(new Set());
  const [mounted, setMounted] = useState<ReadonlySet<ToolId>>(new Set());

  const toggle = (id: ToolId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4">
      <div className="flex flex-wrap content-start gap-3">
        {TOOLS.map((t) => {
          const open = expanded.has(t.id);
          const title = dt(t.title[0], t.title[1]);
          return (
            <Fragment key={t.id}>
              {!open && (
                <button type="button" onClick={() => toggle(t.id)} className={TILE_CLASS}
                  title={dt("Открыть", "Open")}>
                  <span className="flex w-full items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-surface-2 text-ink">
                      <RoyIcon name={t.icon} size={18} />
                    </span>
                    <RoyIcon name="cright" size={12} className="ml-auto text-ink-soft" />
                  </span>
                  <span className="font-semibold text-ink" style={{ fontSize: 15 }}>{title}</span>
                  <span className="text-ink-soft" style={{ fontSize: 13 }}>
                    {mounted.has(t.id)
                      ? dt("Свёрнут — открытое на месте", "Collapsed — your work is still here")
                      : dt(t.text[0], t.text[1])}
                  </span>
                </button>
              )}
              {mounted.has(t.id) && (
                <section hidden={!open} aria-label={title}
                  className="w-full rounded-[12px] border border-line bg-surface">
                  <button type="button" onClick={() => toggle(t.id)}
                    title={dt("Свернуть", "Collapse")}
                    className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left hover:bg-surface-2">
                    <RoyIcon name="cright" size={12} className="text-ink-soft" style={{ transform: "rotate(90deg)" }} />
                    <RoyIcon name={t.icon} size={15} className="text-ink-soft" />
                    <span className="font-semibold text-ink" style={{ fontSize: 14 }}>{title}</span>
                    <span className="truncate text-ink-soft max-[640px]:hidden" style={{ fontSize: 12 }}>· {dt(t.text[0], t.text[1])}</span>
                  </button>
                  {TOOL_BODY[t.id]()}
                </section>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
