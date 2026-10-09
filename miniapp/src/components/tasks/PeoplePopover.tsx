"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { propertyPillCls, PropertyPillBody } from "@/components/ui/PropertyPill";
import { useDt } from "@/components/roy/nav";
import type { Person } from "@/types";

// Выбор людей из справочника воркспейса (#874): исполнитель (один) и соисполнители (много).
// Человека нет в списке — «+ Добавить „Имя“» заводит его тут же, и дальше он подставляется из
// списка (владелец 08.10: «он соответственно утекает в базу и в будущем уже можно подставить
// по списку»). Почта: если в поле набрана почта, она и станет почтой, и именем — по ней
// человек свяжется со своим аккаунтом, когда войдёт через Google.

type Props = {
  people: Person[];
  /** id выбранных людей; у одиночного выбора — не больше одного */
  selected: string[];
  multiple?: boolean;
  onChange: (ids: string[]) => void;
  onCreate: (name: string, email: string | null) => Promise<Person>;
  label: string;
  icon: RoyIconName;
  /** Подпись пустого значения и пункт «снять выбор» (только у одиночного выбора) */
  emptyLabel: string;
  clearLabel?: string;
  /** Подписи выбранных, которых нет в справочнике (старые задачи с именем без человека) */
  fallbackNames?: string[];
};

const W = 280, H = 320;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PeoplePopover({
  people, selected, multiple = false, onChange, onCreate, label, icon, emptyLabel, clearLabel, fallbackNames,
}: Props) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Внутри модального окна (карточка задачи — Radix Dialog) поповер рендерится В окно: окно держит
  // фокус у себя, и поле поиска, вынесенное в body, не получало фокус — имя было не набрать.
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Окно может быть точкой отсчёта для position: fixed (у карточки задачи — CSS translate), и тогда
  // координаты экрана уводят поповер за край. Сдвиг не угадываем по стилям, а замеряем один раз.
  const [shift, setShift] = useState<{ x: number; y: number } | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 && r.top > H ? r.top - H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    setHost(btnRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body);
    setShift(null);
    place();
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open || !pos || !host || shift) return;
    const r = popRef.current?.getBoundingClientRect();
    if (r) setShift({ x: r.left - pos.left, y: r.top - pos.top });
  }, [open, pos, host, shift]);
  useEffect(() => { if (!open) { setQuery(""); setError(null); } }, [open]);
  // Фокус — когда поповер уже стоит на месте: скрытое (visibility: hidden) поле фокус не берёт.
  useEffect(() => { if (open && shift) inputRef.current?.focus(); }, [open, shift]);

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

  const q = query.trim();
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.name.toLowerCase().includes(needle) || (p.email ?? "").includes(needle));
  }, [people, q]);
  const exact = people.some((p) => p.name.toLowerCase() === q.toLowerCase() || p.email === q.toLowerCase());

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const names = selected.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
  const shown = names.length ? names : (fallbackNames ?? []);
  const value = shown.length ? shown.join(", ") : null;

  const toggle = (id: string) => {
    if (!multiple) { onChange([id]); setOpen(false); return; }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const create = async () => {
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const email = EMAIL_RE.test(q) ? q.toLowerCase() : null;
      const person = await onCreate(q, email);
      setQuery("");
      toggle(person.id);
    } catch {
      setError(dt("Не удалось добавить — попробуй ещё раз", "Couldn't add — try again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ? `${label}: ${value}` : label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={propertyPillCls(value != null)}
      >
        <PropertyPillBody icon={icon} label={label} value={value ?? (multiple ? null : emptyLabel)} />
      </button>

      {open && pos && host && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={label}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: pos.left - (shift?.x ?? 0),
            top: pos.top - (shift?.y ?? 0),
            width: W,
            maxHeight: H,
            visibility: shift ? "visible" : "hidden",
          }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (filtered.length === 1) toggle(filtered[0].id);
                else if (!exact) void create();
              }}
              placeholder={dt("Имя или почта", "Name or email")}
              aria-label={dt("Найти или добавить человека", "Find or add a person")}
              className="w-full rounded-lg border border-line-2 bg-surface px-2.5 py-1.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 13 }}
            />
          </div>
          <ul role="listbox" aria-multiselectable={multiple} className="min-h-0 flex-1 overflow-y-auto p-1">
            {!multiple && clearLabel && !q && (
              <PersonRow on={selected.length === 0} name={clearLabel} onClick={() => { onChange([]); setOpen(false); }} />
            )}
            {filtered.map((p) => (
              <PersonRow
                key={p.id}
                on={selected.includes(p.id)}
                name={p.name}
                hint={p.telegram_id == null ? dt("без входа", "no account") : null}
                onClick={() => toggle(p.id)}
              />
            ))}
            {q && !exact && (
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void create()}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-accent-ink hover:bg-surface-2 disabled:opacity-60"
                  style={{ fontSize: 13 }}
                >
                  <RoyIcon name="plus" size={14} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{dt("Добавить", "Add")} «{q}»</span>
                </button>
              </li>
            )}
            {filtered.length === 0 && !q && (
              <li className="px-2.5 py-2 text-ink-mute" style={{ fontSize: 12 }}>
                {dt("Пока никого — набери имя", "Nobody yet — type a name")}
              </li>
            )}
          </ul>
          {error && <p role="alert" className="border-t border-line px-2.5 py-1.5 text-destructive" style={{ fontSize: 12 }}>{error}</p>}
        </div>,
        host,
      )}
    </>
  );
}

function PersonRow({ on, name, hint, onClick }: { on: boolean; name: string; hint?: string | null; onClick: () => void }) {
  return (
    <li role="option" aria-selected={on}>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 ${on ? "font-semibold text-accent-ink" : "text-ink"}`}
        style={{ fontSize: 13 }}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {hint && <span className="shrink-0 text-ink-mute" style={{ fontSize: 11 }}>{hint}</span>}
        {on && <RoyIcon name="check" size={14} strokeWidth={2.2} className="shrink-0" />}
      </button>
    </li>
  );
}
