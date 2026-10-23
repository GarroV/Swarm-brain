"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchQuickSearch, fetchTask, type QuickSearchResult } from "@/lib/api";
import { RoyIcon } from "./icons";
import { useDt, useRoyNav } from "./nav";
import { saveRecent } from "./screens/SearchScreen";

// Поле поиска над разделами (стенд: .search в .nav; решение владельца 2026-09-25 — «наверху,
// над столбцом вкладок надо добавить поле для поиска»). С 19.10.2026 это единственный поиск
// (docs/decisions/2026-10-19-search-and-2fa-deadline.md §1): по ходу ввода под полем — найденное
// на платформе (задачи, проекты, встречи, заметки), клик/Enter на выбранном открывает его; Enter
// без выбора — прежний вопрос базе (ответ со ссылками на источники). ⌘K / Ctrl+K — фокус в поле.
// Паттерн — WAI-ARIA combobox со списком в popup (aria-activedescendant: фокус остаётся в поле).

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

type GroupId = "tasks" | "projects" | "meetings" | "notes";
type Option = { key: string; group: GroupId; id: string; label: string; hint: string | null; muted: boolean };

const GROUP_ORDER: GroupId[] = ["tasks", "projects", "meetings", "notes"];
const GROUP_LABEL: Record<GroupId, [string, string]> = {
  tasks: ["Задачи", "Tasks"],
  projects: ["Проекты", "Projects"],
  meetings: ["Встречи", "Meetings"],
  notes: ["Заметки", "Notes"],
};

/** Строки списка: сгруппированный ответ сервера → плоский порядок, по которому ходят стрелки. */
function toOptions(r: QuickSearchResult): Option[] {
  const out: Option[] = [];
  for (const t of r.tasks) {
    out.push({
      key: `tasks:${t.id}`, group: "tasks", id: t.id, label: t.title, hint: t.due_date,
      muted: t.status === "done" || t.status === "cancelled",
    });
  }
  for (const p of r.projects) {
    out.push({ key: `projects:${p.id}`, group: "projects", id: p.id, label: p.emoji ? `${p.emoji} ${p.name}` : p.name, hint: null, muted: false });
  }
  for (const m of r.meetings) {
    out.push({ key: `meetings:${m.id}`, group: "meetings", id: m.id, label: m.title, hint: m.date, muted: false });
  }
  for (const n of r.notes) {
    out.push({ key: `notes:${n.id}`, group: "notes", id: n.id, label: n.title, hint: n.date, muted: false });
  }
  return out;
}

export function RailSearch() {
  const dt = useDt();
  const { openAnswer, openTask, push, toast } = useRoyNav();
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (key: string) => `${uid}-opt-${key}`;

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [options, setOptions] = useState<Option[]>([]);
  // idle — запроса ещё нет; loading — ждём ответ; done — ответ пришёл (даже пустой); failed — сбой.
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLFormElement>(null);
  // Номер последнего запроса: запоздавший ответ на прежний ввод не должен затереть свежий.
  const seq = useRef(0);

  const term = q.trim();
  const searchable = term.length >= MIN_CHARS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Клик мимо поля и списка закрывает список.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Подсказки: с MIN_CHARS символов, после паузы в наборе.
  useEffect(() => {
    const my = ++seq.current;
    if (!searchable) {
      setOptions([]);
      setPhase("idle");
      setActive(-1);
      return;
    }
    setPhase("loading");
    const timer = setTimeout(() => {
      fetchQuickSearch(term)
        .then((r) => {
          if (my !== seq.current) return;
          setOptions(toOptions(r));
          setActive(-1);
          setPhase("done");
        })
        .catch((e) => {
          if (my !== seq.current) return;
          console.warn("[RailSearch] quick search", e);
          setOptions([]);
          setPhase("failed");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, searchable]);

  const reset = useCallback(() => {
    setQ("");
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  }, []);

  const ask = () => {
    if (!term) return;
    saveRecent(term);
    openAnswer(term);
    reset();
  };

  const choose = (o: Option) => {
    reset();
    if (o.group === "projects") push({ view: "project", params: { id: o.id } });
    else if (o.group === "meetings") push({ view: "meetingDetail", params: { id: o.id } });
    else if (o.group === "notes") push({ view: "record", params: { id: o.id } });
    else {
      // Задачу открывает то же окно-редактор, что и из списков; ему нужна целая задача, не строка подсказки.
      fetchTask(o.id).then(openTask).catch((e) => {
        console.warn("[RailSearch] open task", e);
        toast(dt("Не удалось открыть задачу", "Could not open the task"));
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) setOpen(false);
      else reset();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Круг с «ничем не выбрано» (-1) между последней и первой строкой: оттуда Enter спрашивает базу.
      setActive((i) => {
        const next = i + step;
        return next >= options.length ? -1 : next < -1 ? options.length - 1 : next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = open && active >= 0 ? options[active] : undefined;
      if (picked) choose(picked);
      else ask();
    }
  };

  const showList = open && searchable;
  const activeOption = showList && active >= 0 ? options[active] : undefined;
  const groups = useMemo(
    () => GROUP_ORDER.map((g) => ({ id: g, items: options.filter((o) => o.group === g) })).filter((g) => g.items.length > 0),
    [options],
  );

  return (
    // В узкой рейке — пиктограмма; фокус (клик или ⌘K) раскрывает поле поверх экрана.
    <form ref={root} role="search" className="relative px-2 pt-2.5" onSubmit={(e) => { e.preventDefault(); if (!(open && active >= 0)) ask(); }}>
      <label title={dt("Поиск · ⌘K", "Search · ⌘K")}
        className="group/rs flex h-[30px] items-center gap-2 rounded-[7px] border border-line-2 bg-surface px-2.5 text-ink-mute transition-colors hover:border-ink-mute/40 focus-within:border-primary narrow:justify-center narrow:px-0 narrow:focus-within:absolute narrow:focus-within:left-2 narrow:focus-within:z-50 narrow:focus-within:w-[260px] narrow:focus-within:justify-start narrow:focus-within:px-2.5 narrow:focus-within:shadow-lg">
        <RoyIcon name="search" size={13} />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
          aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
          autoComplete="off" enterKeyHint="search"
          placeholder={dt("Поиск", "Search")} aria-label={dt("Поиск по платформе и базе знаний", "Search the platform and knowledge base")}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute narrow:w-0 narrow:flex-none narrow:group-focus-within/rs:w-auto narrow:group-focus-within/rs:flex-1" style={{ fontSize: 12.5 }} />
        {!q && (
          <kbd className="narrow:hidden rounded-[4px] border border-line-2 border-b-2 px-1 font-mono text-ink-mute" style={{ fontSize: 10 }}>⌘K</kbd>
        )}
      </label>
      {showList && (
        // Список шире рейки: названия задач длиннее 216px. top — под полем (в узкой рейке поле
        // выпадает из потока, поэтому не top-full).
        <div className="absolute left-2 top-[44px] z-50 w-[min(340px,calc(100vw-1rem))] overflow-hidden rounded-[10px] border border-line-2 bg-surface-2 shadow-lg">
          <div id={listId} role="listbox" aria-label={dt("Найдено на платформе", "Found on the platform")} className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
            {groups.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`${uid}-grp-${g.id}`}>
                <div id={`${uid}-grp-${g.id}`} className="px-3 pb-0.5 pt-1.5 font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
                  {dt(...GROUP_LABEL[g.id])}
                </div>
                {g.items.map((o) => {
                  const on = options[active]?.key === o.key;
                  return (
                    <div key={o.key} id={optionId(o.key)} role="option" aria-selected={on}
                      // mousedown не отдаёт фокус: поле остаётся в фокусе, пока выбираем мышью.
                      onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                      onMouseMove={() => { if (!on) setActive(options.findIndex((x) => x.key === o.key)); }}
                      className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5", on ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface")}
                      style={{ fontSize: 12.5 }}>
                      <span className={cn("min-w-0 flex-1 truncate", o.muted && "text-ink-mute line-through")}>{o.label}</span>
                      {o.hint && <span className="shrink-0 font-mono text-ink-mute" style={{ fontSize: 10.5 }}>{o.hint}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {phase !== "done" || options.length === 0 ? (
            <div role="status" className="border-t border-line px-3 py-2 text-ink-mute" style={{ fontSize: 12 }}>
              {phase === "loading" && dt("Ищем…", "Searching…")}
              {phase === "failed" && dt("Подсказки недоступны.", "Suggestions are unavailable.")}
              {phase === "done" && dt("По названию ничего не нашлось.", "Nothing found by name.")}
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-ink-mute" style={{ fontSize: 11.5 }}>
            <kbd className="rounded-[4px] border border-line-2 border-b-2 px-1 font-mono" style={{ fontSize: 10 }}>Enter</kbd>
            <span className="min-w-0 truncate">
              {activeOption ? dt("— открыть выбранное", "— open the selected") : dt("— спросить базу знаний", "— ask the knowledge base")}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
