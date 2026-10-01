"use client";

import type { ReactNode } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

// Поповер, привязанный к кнопке, — на примитиве Base UI, как уже сделаны Dialog и Select
// (components/ui/dialog.tsx, select.tsx). Своё (CountryPopover) пришлось бы научить вложенности
// в модалку, возврату фокуса и Esc, который не закрывает модалку целиком; у Base UI это есть:
// Esc и клик мимо закрывают только поповер, фокус по закрытии возвращается на кнопку.

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: number;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          className={cn(
            "max-w-[calc(100vw-16px)] origin-(--transform-origin) rounded-xl border border-line bg-card p-2.5 text-ink shadow-xl outline-none duration-100 dark:backdrop-blur-lg",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
