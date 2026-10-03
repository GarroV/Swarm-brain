"use client";
import { useDt } from "@/components/roy/nav";

// PDF-редактор прямо в рабочей области «Полезностей» (решение владельца 03.10.2026: «встроить в
// рабочую область проекта? не отдельным окном»). Сам редактор — отдельное приложение
// (GarroV/swarm-pdf) в iframe; его адрес разрешён в frame-src (scripts/gen-csp-headers.mjs).
//
// Панель не размонтируется, когда плитку сворачивают (ToolsDesk держит её скрытой): состояние
// iframe другого сайта отсюда не прочитать и не сохранить, поэтому сворачивание не должно
// уничтожать несохранённую правку. Пропадает она только при уходе со страницы.

// `?embed=1` — редактор прячет обвязку своего сайта (шапку, «к инструментам», подвал):
// внутри Swarm она лишняя и уводит со страницы (swarm-pdf: src/js/logic/swarm-embed.ts).
const embedUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}embed=1`;

export function PdfEditorPanel({ url }: { url: string }) {
  const dt = useDt();
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-ink-soft" style={{ fontSize: 12 }}>
        <span>{dt("Файл не покидает браузер. Сохраните его кнопкой редактора, прежде чем уйти со страницы", "The file never leaves your browser. Save it with the editor's button before leaving the page")}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto hover:text-ink">
          {dt("Открыть в новой вкладке", "Open in a new tab")}
        </a>
      </div>
      <iframe
        src={embedUrl(url)}
        aria-label={dt("PDF-редактор", "PDF editor")}
        allow="clipboard-read; clipboard-write; local-fonts"
        className="h-[calc(100dvh-220px)] min-h-[560px] w-full rounded-b-[12px] border-0 border-t border-line bg-white"
      />
    </div>
  );
}
