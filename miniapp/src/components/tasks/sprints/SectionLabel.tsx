"use client";

/** Подпись блока «Мои задачи» / «Остальные» над списком состава. */
export function SectionLabel(
  { label, count }: { label: string; count: number },
) {
  return (
    <div
      className="mb-1.5 mt-1 flex items-center gap-2 px-0.5 font-semibold uppercase tracking-[0.06em] text-ink-mute"
      style={{ fontSize: 11 }}
    >
      {label}
      <span className="font-mono">{count}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
