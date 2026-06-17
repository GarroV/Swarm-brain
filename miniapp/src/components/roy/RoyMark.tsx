// Бренд-марка «Рой»: янтарный чип + сота (honeycomb) с роем из трёх точек.
// Заменяет прежнюю букву «Р». Масштабируется размером; цвет глифа — currentColor (белый на чипе).
export function RoyMark({ size = 32, className }: { size?: number; className?: string }) {
  const radius = Math.round(size * 0.31);
  const glyph = Math.round(size * 0.64);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-primary text-white ${className ?? ""}`}
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        {/* сота */}
        <path d="M20 12 16 18.93 8 18.93 4 12 8 5.07 16 5.07Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        {/* рой — три точки */}
        <circle cx="12" cy="9.3" r="1.5" fill="currentColor" />
        <circle cx="9.5" cy="13.5" r="1.5" fill="currentColor" />
        <circle cx="14.5" cy="13.5" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}
