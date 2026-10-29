"use client";

import { useEffect, useRef, useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

const FEEDBACK_MS = 2000;

// Маленькая кнопка «Копировать» для длинного текста (транскрипт вычитки и записи). Текст берётся
// в момент нажатия (`getText`): строить его при каждом рендере ради клика незачем. После успеха —
// «Скопировано» на пару секунд; отказ буфера (не https, запрет браузера) показываем, а не глотаем.
export function CopyButton({ getText, title }: { getText: () => string; title?: string }) {
  const dt = useDt();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = (next: "copied" | "failed") => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      flash("copied");
    } catch (err) {
      console.error("clipboard write failed", err);
      flash("failed");
    }
  };

  const label = state === "copied" ? dt("Скопировано", "Copied")
    : state === "failed" ? dt("Не удалось скопировать", "Couldn't copy")
    : dt("Копировать", "Copy");
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-live="polite"
      className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 font-medium text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      style={{ fontSize: 11, minHeight: 24, ...(state === "failed" ? { color: "var(--pri-high)" } : null) }}
    >
      <RoyIcon name={state === "copied" ? "check" : "copy"} size={12} strokeWidth={state === "copied" ? 2.1 : 1.7} className="shrink-0" />
      {label}
    </button>
  );
}
