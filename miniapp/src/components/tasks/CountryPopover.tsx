"use client";
// Выбор стран задачи (несколько): компактный триггер с КОДАМИ («HU · RS», больше трёх —
// «HU · RS +2») + портал-поповер со списком «код + название» и поиском. Выбор по названию, на
// задаче и в триггере — только коды (решение владельца 10.11.2026, #1262). Раньше поповер был
// сеткой флагов на одну страну. Механика портала/placement/клик-вне/Escape/репозиции зеркалит
// QuickPickPopover (модалка скроллится — absolute-поповер обрезался бы её overflow-y-auto,
// поэтому рендерим в body).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "@/components/roy/icons";
import { countryName, countryCode, countriesLabel, countriesTitle, toggleCountry } from "@/lib/countries";
import { propertyPillCls } from "@/components/ui/PropertyPill";
import { useDt } from "@/components/roy/nav";

type Props = {
  value: string[];               // выбранные коды (пусто = Global, задача без страны)
  codes: string[];               // коды, из которых выбирают (рынки воркспейса)
  onChange: (codes: string[]) => void;
  // Триггер: "chip" — чип с текущими странами (форма); "icon" — компактная иконка (плотная
  // строка задачи); "pill" — чип свойства в карточке задачи. Тело поповера одинаково везде.
  variant?: "chip" | "icon" | "pill";
  /** Название свойства в виде "pill" — подсказка и подпись для скринридера (по умолчанию «Страна»). */
  label?: string;
};

const W = 264, H = 340;

export function CountryPopover({ value, codes, onChange, variant = "chip", label: labelProp }: Props) {
  const dt = useDt();
  const label = labelProp ?? dt("Страна", "Country");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 && r.top > H ? r.top - H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Порядок строк не зависит от выбора: список не «прыгает» под курсором, когда человек отмечает
  // вторую и третью страну подряд.
  const chosen = value.map(countryCode);
  const q = query.trim().toLowerCase();
  const rows = codes
    .map(countryCode)
    .filter((c, i, all) => all.indexOf(c) === i)
    .filter((c) => !q || c.toLowerCase().includes(q) || countryName(c).toLowerCase().includes(q));
  // Выбранная страна вне рынков воркспейса (легаси) не пропадает из списка.
  for (const c of chosen) if (!q && !rows.includes(c)) rows.push(c);

  const text = countriesLabel(value);
  const title = value.length ? `${label}: ${countriesTitle(value)}` : `${label}: Global`;
  // stopPropagation: в строке задачи клик не должен всплывать в открытие карточки / съедаться свайпом.
  const toggle = (e: { stopPropagation: () => void }) => { e.stopPropagation(); setQuery(""); setOpen((o) => !o); };

  return (
    <>
      {variant === "icon" ? (
        // Триггер плотной строки: глобус, подсвечен при выбранных странах (коды — в подсказке и в
        // колонке «Рынок»: ширина этой колонки действий фиксирована, коды в неё не влезают).
        <button
          ref={btnRef}
          type="button"
          aria-label={label}
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className="flex items-center justify-center rounded-full border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ width: 26, height: 26, color: value.length ? "var(--accent-ink)" : "var(--ink-soft)" }}
        >
          <RoyIcon name="globe" size={15} strokeWidth={1.9} />
        </button>
      ) : variant === "pill" ? (
        // Чип свойства (карточка задачи): коды стран; без страны — «Global» (задача на всех).
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={title}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className={propertyPillCls(true)}
        >
          <RoyIcon name="globe" size={14} strokeWidth={1.9} className="shrink-0 text-ink-mute" />
          <span className="sr-only">{label}: </span>
          <span className={`min-w-0 max-w-[200px] truncate ${value.length ? "font-mono font-semibold" : ""}`} style={{ fontSize: 12.5 }}>{value.length ? text : "Global"}</span>
        </button>
      ) : (
        // Чип-триггер (форма): текущие страны одной строкой; клик открывает список.
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={title}
          onClick={toggle}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
            value.length
              ? "border-primary bg-accent-soft text-accent-ink"
              : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"
          }`}
          style={{ fontSize: 13 }}
        >
          <RoyIcon name="globe" size={14} strokeWidth={1.9} />
          <span className={`truncate ${value.length ? "font-mono" : ""}`}>{value.length ? text : "Global"}</span>
          <RoyIcon
            name="cright"
            size={13}
            strokeWidth={1.9}
            className={`shrink-0 text-ink-mute transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
          />
        </button>
      )}

      {open && pos && createPortal(
        <div
          ref={popRef}
          data-escape-layer=""
          role="menu"
          aria-multiselectable="true"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <RoyIcon name="search" size={13} className="shrink-0 text-ink-mute" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dt("Код или название", "Code or name")}
              aria-label={dt("Найти страну", "Find a country")}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 13 }}
            />
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-ink-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                style={{ fontSize: 12 }}
                title={dt("Убрать все страны (Global)", "Clear all countries (Global)")}
              >
                {dt("Сбросить", "Clear")}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {rows.length === 0 && (
              <div className="px-2.5 py-3 text-ink-mute" style={{ fontSize: 12.5 }}>{dt("Ничего не найдено", "Nothing found")}</div>
            )}
            {rows.map((code) => {
              const on = chosen.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => onChange(toggleCountry(value, code))}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none ${on ? "text-accent-ink" : "text-ink"}`}
                  style={{ fontSize: 13 }}
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] border ${on ? "border-primary bg-primary text-primary-foreground" : "border-line-2 bg-surface"}`}
                  >
                    {on && <RoyIcon name="check" size={11} strokeWidth={2.6} />}
                  </span>
                  <span className="w-7 shrink-0 font-mono font-semibold">{code}</span>
                  <span className="min-w-0 truncate text-ink-soft">{countryName(code)}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
