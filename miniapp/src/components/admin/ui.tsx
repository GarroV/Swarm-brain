// Общие мелочи экранов админки: классы полей и кнопок и подпись поля. Вынесены из AdminScreen.tsx,
// когда экран «Пространства» разошёлся по файлам (список/деталь, люди, рынки, перенос).
export const fieldCls =
  "w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute";
export const btnPrimary =
  "rounded-full bg-primary px-3.5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
export const btnGhost =
  "rounded-full border border-line bg-surface px-3.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function Lbl({ t }: { t: string }) {
  return <span className="mb-1 block font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>{t}</span>;
}
