"use client";
import { useState } from "react";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";
import type { RoyIconName } from "@/lib/royIcons";
import { ShortLinkTool } from "./ShortLinkTool";

// «Полезности» (решение владельца 2026-10-02): плитки небольших сервисов. Первый — сокращатель
// ссылок. Новый сервис = запись в TOOLS + его компонент; плитка открывает его на месте,
// «назад» возвращает к плиткам.

type ToolId = "shortLinks";

const TOOLS: { id: ToolId; icon: RoyIconName; title: [string, string]; text: [string, string] }[] = [
  {
    id: "shortLinks",
    icon: "link",
    title: ["Короткие ссылки", "Short links"],
    text: ["Длинная ссылка → короткая, для SMS и сообщений", "Long link → short one, for SMS and messages"],
  },
];

export function ToolsDesk() {
  const dt = useDt();
  const [open, setOpen] = useState<ToolId | null>(null);

  if (open === "shortLinks") return <ShortLinkTool onBack={() => setOpen(null)} />;

  return (
    <div className="mx-auto w-full max-w-[880px] p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpen(t.id)}
            className="flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface p-4 text-left transition-transform hover:shadow-[0_0_0_1px_var(--color-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.98]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-surface-2 text-ink">
              <RoyIcon name={t.icon} size={18} />
            </span>
            <span className="font-semibold text-ink" style={{ fontSize: 15 }}>{dt(t.title[0], t.title[1])}</span>
            <span className="text-ink-soft" style={{ fontSize: 13 }}>{dt(t.text[0], t.text[1])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
