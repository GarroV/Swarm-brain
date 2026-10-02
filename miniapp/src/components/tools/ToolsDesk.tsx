"use client";
import { useState } from "react";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";
import type { RoyIconName } from "@/lib/royIcons";
import { ShortLinkTool } from "./ShortLinkTool";
import { PdfEditorModal } from "./PdfEditorModal";

// «Полезности» (решение владельца 2026-10-02): плитки небольших сервисов. Первый — сокращатель
// ссылок. Новый сервис = запись в TOOLS + его компонент; плитка открывает его на месте,
// «назад» возвращает к плиткам. PDF-редактор — отдельное приложение на своём адресе, открывается
// окном поверх плиток (решение владельца 03.10.2026: окно, а не новая вкладка; issue #771).

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

const TILE_CLASS =
  "flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface p-4 text-left transition-transform hover:shadow-[0_0_0_1px_var(--color-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.98]";

export function ToolsDesk() {
  const dt = useDt();
  const [open, setOpen] = useState<ToolId | null>(null);

  if (open === "shortLinks") return <ShortLinkTool onBack={() => setOpen(null)} />;

  return (
    <div className="mx-auto w-full max-w-[880px] p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpen(t.id)} className={TILE_CLASS}>
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-surface-2 text-ink">
              <RoyIcon name={t.icon} size={18} />
            </span>
            <span className="font-semibold text-ink" style={{ fontSize: 15 }}>{dt(t.title[0], t.title[1])}</span>
            <span className="text-ink-soft" style={{ fontSize: 13 }}>{dt(t.text[0], t.text[1])}</span>
          </button>
        ))}
      </div>
      {open === "pdfEditor" && <PdfEditorModal url={PDF_EDITOR_URL} dt={dt} onClose={() => setOpen(null)} />}
    </div>
  );
}
