"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { cn } from "@/lib/utils";

// Единое контекстное окно подтверждения (замена нативного window.confirm) — в стиле
// roy-стекла приложения. Promise-based: `const confirm = useConfirm(); if (!(await
// confirm({...}))) return;`. Один экземпляр монтируется в корне (ConfirmProvider).

type ConfirmTone = "danger" | "default";

export interface ConfirmOptions {
  /** Заголовок — короткий вопрос (обычно с «?»). */
  title: string;
  /** Пояснение — что именно произойдёт / что необратимо. */
  description?: React.ReactNode;
  /** Подпись кнопки подтверждения. По умолчанию «Удалить» (danger) / «Продолжить». */
  confirmText?: string;
  /** Подпись кнопки отмены. По умолчанию «Отмена». */
  cancelText?: string;
  /** Тон: danger — красная кнопка (по умолчанию, все наши подтверждения деструктивны). */
  tone?: ConfirmTone;
  /** Иконка (roy). По умолчанию warn для danger. */
  icon?: RoyIconName;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/** Возвращает функцию confirm(options): Promise<boolean>. Только внутри <ConfirmProvider>. */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((ok: boolean) => void) | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    // Если предыдущий запрос ещё висит (не должно случаться — окно модальное) — отменяем.
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
      setOpen(true);
    });
  }, []);

  const settle = React.useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpen(false);
  }, []);

  const tone = options?.tone ?? "danger";
  const icon = options?.icon ?? (tone === "danger" ? "warn" : "spark");
  const confirmText = options?.confirmText ?? (tone === "danger" ? "Удалить" : "Продолжить");
  const cancelText = options?.cancelText ?? "Отмена";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          // Escape / клик по фону закрывают окно — трактуем как отмену.
          if (!next) settle(false);
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setOptions(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
          <DialogPrimitive.Popup
            initialFocus={cancelRef}
            aria-labelledby="confirm-title"
            className="fixed top-1/2 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[22px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none duration-150 dark:backdrop-blur-xl data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
          >
            {options && (
              <>
                <div className="flex items-start gap-3.5">
                  <span
                    className={cn(
                      "mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full",
                      tone === "danger" ? "bg-destructive/12 text-destructive" : "bg-primary/12 text-primary",
                    )}
                    aria-hidden
                  >
                    <RoyIcon name={icon} size={22} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <DialogPrimitive.Title
                      id="confirm-title"
                      className="font-heading text-[17px] leading-snug font-bold text-ink"
                      style={{ letterSpacing: "-0.01em" }}
                    >
                      {options.title}
                    </DialogPrimitive.Title>
                    {options.description && (
                      <DialogPrimitive.Description className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-line text-ink-soft">
                        {options.description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <Button
                    ref={cancelRef}
                    variant="outline"
                    size="lg"
                    className="h-11 rounded-[14px] text-[15px]"
                    onClick={() => settle(false)}
                  >
                    {cancelText}
                  </Button>
                  <Button
                    variant={tone === "danger" ? "destructive" : "default"}
                    size="lg"
                    className={cn(
                      "h-11 rounded-[14px] text-[15px] font-semibold",
                      tone === "danger" &&
                        "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:text-white dark:hover:bg-destructive/90",
                    )}
                    onClick={() => settle(true)}
                  >
                    {confirmText}
                  </Button>
                </div>
              </>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}
