"use client";
import { RoyIcon } from "./icons";

// Карандаш прямо у того, что правится: у названия встречи — за последним словом, у тезисов — в
// шапке блока «Кратко от ИИ». Раньше правка жила отдельными чипами «Название»/«Тезисы» в ряду
// действий, и связь «эта кнопка — про этот текст» приходилось угадывать (владелец 27.10.2026).
export function EditPencil({ label, onClick, size = 30, tone = "ink" }: {
  label: string;
  onClick: () => void;
  size?: number;
  tone?: "ink" | "accent";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition-colors active:scale-[0.94] ${
        tone === "accent"
          ? "border border-accent-line bg-card/60 text-accent-ink hover:bg-card"
          : "text-ink-mute hover:bg-surface-2 hover:text-ink"
      }`}
      style={{ width: size, height: size }}
    >
      <RoyIcon name="pencil" size={Math.round(size * 0.45)} strokeWidth={1.9} />
    </button>
  );
}
