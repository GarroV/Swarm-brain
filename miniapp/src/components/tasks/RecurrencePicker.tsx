"use client";
// Меню повторяемости задачи (#823). Одно на строку задачи (вид «icon», быстрые действия) и на
// карточку (вид «segment», сегмент пилюли «срок · пинг · повтор»).
//
// Два меню: быстрое — «не повторять» и каждый день/неделю/месяц/год в формулировке от срока,
// плюс «Настроить…»; оно открывает ОТДЕЛЬНОЕ меню правила — «каждые N дней/недель/месяцев/
// лет», дни недели для недель, «15-го / 3-й понедельник / последний понедельник» для месяцев и
// превью трёх ближайших дат. Правило применяется кнопкой «Готово»; Esc и клик мимо — отмена.
//
// Без срока повтор считать не от чего, поэтому меню подставляет срок = сегодня и отдаёт его
// вызывающему вместе с правилом («каждые 2 недели от текущей даты» — ровно этот случай).
//
// Механика поповера — как у DatePicker/QuickPickPopover: портал в body, fixed по триггеру,
// флип у нижнего края, клик-вне, Escape, репозиция на scroll/resize.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "@/components/roy/icons";
import { pillSegmentCls } from "@/components/ui/PropertyPill";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtShort, toISO, weekdays } from "@/lib/calendar";
import { isoWeekday, RECUR_INTERVAL_MAX, type RecurFreq } from "@/lib/recurrenceRule";
import {
  isQuickValue,
  monthlyModes,
  previewDates,
  QUICK_FREQS,
  quickValue,
  recurrenceLabel,
  recurrenceOptions,
  type RecurrenceOption,
  type RecurValue,
} from "@/lib/recurrenceLabels";

type Props = {
  value: RecurValue | null;
  /** Срок задачи ("" — срока нет: меню возьмёт сегодня). */
  due: string;
  /** Якорь числа (monthly/yearly) — только пока срок не трогали. */
  anchorDom?: number | null;
  /** due — срок, который надо выставить вместе с правилом (был пуст), иначе null. */
  onChange: (value: RecurValue | null, due: string | null) => void;
  variant: "icon" | "segment";
};

const W = 288;
const H_MENU = 280;
const H_RULE = 420;

const sameRule = (a: RecurValue | null, b: RecurValue | null) =>
  JSON.stringify(a) === JSON.stringify(b);

export function RecurrencePicker({ value, due, anchorDom, onChange, variant }: Props) {
  const dt = useDt();
  const lang = useLang();
  const [view, setView] = useState<"closed" | "menu" | "rule">("closed");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [draft, setDraft] = useState<RecurValue>(quickValue("weekly"));
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const today = toISO(new Date());
  const effDue = due || today;
  const open = view !== "closed";

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = popRef.current?.offsetHeight ?? (view === "rule" ? H_RULE : H_MENU);
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 && r.top > h ? r.top - h - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, [view]);

  useLayoutEffect(() => { if (open) place(); }, [open, view, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setView("closed");
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setView("closed"); };
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

  const label = recurrenceLabel(value, effDue, anchorDom);
  const labelText = label ? dt(label.ru, label.en) : null;
  const quick = recurrenceOptions(effDue, anchorDom) ?? [];

  const commit = (v: RecurValue | null) => {
    onChange(v, v && !due ? today : null);
    setView("closed");
  };

  const openRule = () => {
    // Черновик — от текущего правила; для недель без набора дней — день недели срока.
    const base = value ?? quickValue("weekly");
    setDraft(base.freq === "weekly" && !base.weekdays
      ? { ...base, weekdays: [isoWeekday(effDue) ?? 1] }
      : { ...base });
    setView("rule");
  };

  const title = `${dt("Повтор", "Repeat")}: ${labelText ?? dt("не повторять", "never")}`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setView((v) => (v === "closed" ? "menu" : "closed")); }}
        className={variant === "segment"
          ? pillSegmentCls(!!value)
          : "flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"}
        style={variant === "icon" ? { color: value ? "var(--accent-ink)" : "var(--ink-soft)" } : undefined}
      >
        <RoyIcon name="repeat" size={variant === "icon" ? 15 : 14} strokeWidth={variant === "icon" ? 1.9 : 2} />
        {variant === "segment" && labelText && (
          <span className="max-w-[220px] truncate whitespace-nowrap" style={{ fontSize: 12.5 }}>{labelText}</span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={view === "rule" ? dt("Правило повтора", "Repeat rule") : dt("Повтор", "Repeat")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxWidth: "calc(100vw - 16px)" }}
          className="z-[100] rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          {view === "menu" ? (
            <QuickMenu
              value={value}
              quick={quick}
              customLabel={value && !isQuickValue(value) ? labelText : null}
              onPick={commit}
              onCustom={openRule}
              dt={dt}
            />
          ) : (
            <RuleEditor
              draft={draft}
              setDraft={setDraft}
              due={effDue}
              dueIsToday={!due}
              today={today}
              lang={lang}
              onBack={() => setView("menu")}
              onDone={() => commit(normalizeDraft(draft, effDue))}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function QuickMenu({ value, quick, customLabel, onPick, onCustom, dt }: {
  value: RecurValue | null;
  quick: RecurrenceOption[];
  customLabel: string | null;
  onPick: (v: RecurValue | null) => void;
  onCustom: () => void;
  dt: (ru: string, en: string) => string;
}) {
  const row = (key: string, text: string, on: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-surface-2 sm:py-1.5 ${on ? "text-accent-ink" : "text-ink"}`}
      style={{ fontSize: 13 }}
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {on && <RoyIcon name="check" size={14} strokeWidth={2.2} className="shrink-0" />}
    </button>
  );
  return (
    <div className="p-1">
      {row("none", dt("Не повторять", "Never"), !value, () => onPick(null))}
      {quick.map((o) => row(o.id, dt(o.ru, o.en), sameRule(value, o.value), () => onPick(o.value)))}
      {customLabel && row("custom-current", customLabel, true, onCustom)}
      <div className="my-1 border-t border-line" />
      <button
        type="button"
        onClick={onCustom}
        className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink sm:py-1.5"
        style={{ fontSize: 13 }}
      >
        <RoyIcon name="sliders" size={14} className="shrink-0" />
        <span className="flex-1">{dt("Настроить…", "Custom…")}</span>
        <RoyIcon name="cright" size={13} className="shrink-0 text-ink-mute" />
      </button>
      <p className="px-2.5 pb-1.5 pt-1 text-ink-mute" style={{ fontSize: 11 }}>
        {dt(
          "Отметишь готовой — задача не закроется, а перенесётся на следующий раз",
          "Marking it done rolls the task to its next occurrence instead of closing it",
        )}
      </p>
    </div>
  );
}

/** Набор дней недели, совпадающий с днём срока, храним как null — он пойдёт за сроком. */
function normalizeDraft(d: RecurValue, due: string): RecurValue {
  const interval = Math.min(Math.max(Math.round(d.interval) || 1, 1), RECUR_INTERVAL_MAX);
  if (d.freq !== "weekly") {
    return { freq: d.freq, interval, weekdays: null, setpos: d.freq === "monthly" ? d.setpos : null };
  }
  const days = d.weekdays?.length ? [...new Set(d.weekdays)].sort((a, b) => a - b) : null;
  const onlyDue = days?.length === 1 && days[0] === isoWeekday(due);
  return { freq: "weekly", interval, weekdays: onlyDue ? null : days, setpos: null };
}

const UNIT: Record<RecurFreq, [string, string]> = {
  daily: ["Дни", "Days"],
  weekly: ["Недели", "Weeks"],
  monthly: ["Месяцы", "Months"],
  yearly: ["Годы", "Years"],
};

const chipCls = (on: boolean) =>
  `inline-flex min-h-9 items-center justify-center rounded-full border px-2.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:min-h-[28px] ${on
    ? "border-primary bg-accent-soft text-accent-ink"
    : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink"}`;

function RuleEditor({ draft, setDraft, due, dueIsToday, today, lang, onBack, onDone }: {
  draft: RecurValue;
  setDraft: (v: RecurValue) => void;
  due: string;
  dueIsToday: boolean;
  today: string;
  lang: "ru" | "en";
  onBack: () => void;
  onDone: () => void;
}) {
  const dt = (ru: string, en: string) => (lang === "en" ? en : ru);
  const rule = normalizeDraft(draft, due);
  const summary = recurrenceLabel(rule, due);
  const preview = previewDates(rule, due, today);
  const dueWd = isoWeekday(due) ?? 1;
  const weekdayNames = weekdays(lang);

  const setFreq = (freq: RecurFreq) =>
    setDraft({
      freq,
      interval: draft.interval,
      weekdays: freq === "weekly" ? (draft.weekdays ?? [dueWd]) : null,
      setpos: null,
    });
  const setInterval = (n: number) =>
    setDraft({ ...draft, interval: Math.min(Math.max(n, 1), RECUR_INTERVAL_MAX) });
  const toggleDay = (d: number) => {
    const cur = draft.weekdays ?? [dueWd];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    // Пустой набор правилу не нужен: последний день не снимается.
    if (next.length) setDraft({ ...draft, weekdays: next });
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={dt("Назад", "Back")}
          className="-ml-1 rounded-full p-1.5 text-ink-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <RoyIcon name="cleft" size={14} />
        </button>
        <span className="font-semibold text-ink" style={{ fontSize: 13 }}>{dt("Правило повтора", "Repeat rule")}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-ink-soft" style={{ fontSize: 12.5 }}>{dt("Каждые", "Every")}</span>
        <div className="inline-flex items-center rounded-full border border-line-2 bg-surface">
          <button type="button" aria-label={dt("Меньше", "Fewer")} onClick={() => setInterval(draft.interval - 1)}
            disabled={draft.interval <= 1}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2 disabled:opacity-40 sm:h-7 sm:w-7">−</button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={RECUR_INTERVAL_MAX}
            value={draft.interval}
            aria-label={dt("Интервал", "Interval")}
            onChange={(e) => setInterval(Number(e.target.value) || 1)}
            className="w-9 bg-transparent text-center font-semibold text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ fontSize: 13 }}
          />
          <button type="button" aria-label={dt("Больше", "More")} onClick={() => setInterval(draft.interval + 1)}
            disabled={draft.interval >= RECUR_INTERVAL_MAX}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2 disabled:opacity-40 sm:h-7 sm:w-7">+</button>
        </div>
      </div>

      <div role="radiogroup" aria-label={dt("Единица", "Unit")} className="grid grid-cols-4 gap-1">
        {QUICK_FREQS.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={draft.freq === f}
            onClick={() => setFreq(f)} className={chipCls(draft.freq === f)} style={{ fontSize: 11.5 }}>
            {dt(UNIT[f][0], UNIT[f][1])}
          </button>
        ))}
      </div>

      {draft.freq === "weekly" && (
        <div role="group" aria-label={dt("Дни недели", "Weekdays")} className="grid grid-cols-7 gap-1">
          {weekdayNames.map((name, i) => {
            const d = i + 1;
            const on = (draft.weekdays ?? [dueWd]).includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => toggleDay(d)}
                className={`${chipCls(on)} px-0`} style={{ fontSize: 11.5 }}>
                {name}
              </button>
            );
          })}
        </div>
      )}

      {draft.freq === "monthly" && (
        <div role="radiogroup" aria-label={dt("День месяца", "Day of month")} className="flex flex-wrap gap-1">
          {monthlyModes(due).map((m) => (
            <button key={String(m.setpos)} type="button" role="radio" aria-checked={draft.setpos === m.setpos}
              onClick={() => setDraft({ ...draft, setpos: m.setpos })}
              className={chipCls(draft.setpos === m.setpos)} style={{ fontSize: 11.5 }}>
              {dt(m.ru, m.en)}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg bg-surface-2 px-2.5 py-2" aria-live="polite">
        <div className="font-semibold text-ink" style={{ fontSize: 12.5 }}>{summary ? dt(summary.ru, summary.en) : "—"}</div>
        <div className="mt-0.5 text-ink-mute" style={{ fontSize: 11.5 }}>
          {dueIsToday
            ? dt(`Срок — сегодня, ${fmtShort(due, lang)}`, `Due today, ${fmtShort(due, lang)}`)
            : dt(`Срок — ${fmtShort(due, lang)}`, `Due ${fmtShort(due, lang)}`)}
          {preview.length > 0 && (
            <>
              {" · "}
              {dt("дальше", "then")} {preview.map((d) => fmtShort(d, lang)).join(", ")}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="min-h-9 rounded-full bg-primary font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:min-h-[30px]"
        style={{ fontSize: 13 }}
      >
        {dt("Готово", "Done")}
      </button>
    </div>
  );
}
