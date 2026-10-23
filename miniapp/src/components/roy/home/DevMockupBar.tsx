"use client";
import { useEffect, useState } from "react";
import { DEV_MOCKUP, MOCKUP_FILLS, MOCKUP_LAYOUTS, mockupParams } from "@/lib/devMockup";

// Полоска-переключатель стенда-макета главной (только DEV_MODE, только когда в адресе есть
// ?layout= или ?fill=; lib/devMockup.ts). Ссылки перезагружают страницу — моки читают параметры заново.
export function DevMockupBar() {
  const [cur, setCur] = useState<ReturnType<typeof mockupParams>>(null);
  useEffect(() => { setCur(mockupParams()); }, []);
  if (!DEV_MOCKUP || !cur) return null;
  const href = (layout: string, fill: string) => `?layout=${layout}&fill=${fill}`;
  return (
    <div className="mx-6 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[8px] border border-dashed border-line-2 bg-surface-2 px-3 py-1.5 text-ink-soft" style={{ fontSize: 12 }}>
      <b className="text-ink">Макет</b>
      {MOCKUP_FILLS.map((fill) => (
        <span key={fill} className="flex items-center gap-1.5">
          <span className="text-ink-mute">{fill}:</span>
          {MOCKUP_LAYOUTS.map((layout) => {
            const on = (cur.layout ?? "A") === layout && (cur.fill ?? "full") === fill;
            return (
              <a key={layout} href={href(layout, fill)}
                className={`rounded-[6px] border px-2 py-0.5 font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-line-2 hover:border-accent-line hover:text-primary"}`}>
                {layout}
              </a>
            );
          })}
        </span>
      ))}
    </div>
  );
}
