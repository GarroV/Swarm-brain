"use client";
// Плашка «ON AIR» рядом с названием встречи, пока бот встреч пишет её (recording_now с сервера, #1026).
// Текст через dt: «В ЭФИРЕ» / ON AIR. Видимой подсказки (title) нет — только aria-label для читалок.
// Точка «дышит» классом rec-dot (globals.css), при «уменьшить движение» стоит.
import { useDt } from "../nav";

export function OnAirBadge({ size = 11 }: { size?: number }) {
  const dt = useDt();
  const label = dt("Идёт запись", "Recording now");
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 font-bold uppercase"
      style={{
        fontSize: size,
        letterSpacing: "0.06em",
        color: "var(--pri-high)",
        background: "color-mix(in srgb, var(--pri-high) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--pri-high) 35%, transparent)",
        borderRadius: 6,
        padding: "1px 6px",
        lineHeight: 1.3,
      }}
    >
      <span className="rec-dot size-1.5 shrink-0 rounded-full" style={{ background: "var(--pri-high)" }} aria-hidden />
      {dt("В ЭФИРЕ", "ON AIR")}
    </span>
  );
}
