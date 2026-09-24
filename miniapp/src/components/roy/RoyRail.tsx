"use client";
import { useEffect, useRef, useState } from "react";
import { cn, displayName } from "@/lib/utils";
import { fetchConfig } from "@/lib/api";
import { Avatar } from "./ui";
import { RoyIcon, type RoyIconName } from "./icons";
import { initials } from "./dash/shared";
import { useDt, useRoyNav } from "./nav";
import { saveRecent } from "./screens/SearchScreen";

// Левая рейка десктопа — навигация нового вида (витрина, решение владельца 24.09.2026:
// «оставляем текущие экраны, но навигация между ними уже новая»). Плоский список папок,
// как в стенде (docs/redesign/stand/js/app.js → NAV/NAVFOOT). Экраны внутри — прежние.
// Мобайл рейку не видит: там нижний таб-бар (RoyTabBar).

export type RailId =
  | "home"
  | "tasks"
  | "projects"
  | "sprints"
  | "meetings"
  | "base"
  | "team"
  | "settings"
  | "admin";

type RailItem = { id: RailId; label: [string, string]; icon: RoyIconName };

const MAIN: RailItem[] = [
  { id: "home", label: ["Главная", "Home"], icon: "home" },
  { id: "tasks", label: ["Задачи", "Tasks"], icon: "task" },
  { id: "projects", label: ["Проекты", "Projects"], icon: "board" },
  { id: "sprints", label: ["Спринты", "Sprints"], icon: "repeat" },
  { id: "meetings", label: ["Встречи", "Meetings"], icon: "cal" },
  { id: "base", label: ["База", "Knowledge"], icon: "book" },
  { id: "team", label: ["Команда", "Team"], icon: "team" },
];

const FOOT: RailItem[] = [
  { id: "settings", label: ["Настройки", "Settings"], icon: "dots" },
  { id: "admin", label: ["Админ", "Admin"], icon: "lock" },
];

export function RoyRail({
  active,
  onSelect,
  badges,
}: {
  active: RailId | null;
  onSelect: (id: RailId) => void;
  badges?: Partial<Record<RailId, number>>;
}) {
  const { me } = useRoyNav();
  const dt = useDt();
  const foot = FOOT.filter((i) => i.id !== "admin" || me?.is_admin);
  const [wsName, setWsName] = useState<string | null>(null);

  // Подпись воркспейса под брендом (стенд: .ws-sub). Не пришло имя — подписи нет, рейка не ломается.
  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => { if (alive) setWsName(c.workspace_name?.trim() || null); })
      .catch((e) => console.warn("[RoyRail] workspace name", e));
    return () => { alive = false; };
  }, []);

  const renderItem = (item: RailItem) => {
    const on = active === item.id;
    const badge = badges?.[item.id] ?? 0;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          on
            ? "bg-accent-soft font-semibold text-accent-ink shadow-[inset_2px_0_0_var(--primary)]"
            : "text-ink-soft hover:bg-surface hover:text-ink",
        )}
        style={{ fontSize: 13.5 }}
      >
        <RoyIcon name={item.icon} size={16} strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">{dt(item.label[0], item.label[1])}</span>
        {badge > 0 && (
          // Счётчик по стенду — тихой серой цифрой, не синей плашкой (визуальный шаг В2).
          <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label={dt("Разделы", "Sections")}
      className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface-2"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        {/* Бренд-блок по стенду: тёмный квадрат с «S» и имя капсом (визуальный шаг В2). */}
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-ink font-bold text-surface"
          style={{ fontSize: 13 }}
        >
          S
        </span>
        <span className="flex min-w-0 flex-col">
          {/* Полное имя продукта (решение владельца 2026-09-25: «тут надо сворм брейн»). */}
          <span className="truncate font-bold text-ink" style={{ fontSize: 13.5, letterSpacing: "0.04em" }}>
            SWARM BRAIN
          </span>
          {wsName && (
            <span className="truncate uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.1em" }} title={wsName}>
              {wsName}
            </span>
          )}
        </span>
      </div>
      <RailSearch />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2.5">
        {MAIN.map(renderItem)}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-line px-2 py-2">
        {foot.map(renderItem)}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <Avatar size={26}>{initials(me?.name)}</Avatar>
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink" style={{ fontSize: 13 }}>
            {displayName(me?.name) || dt("Профиль", "Profile")}
          </div>
          <div className="font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
            {me?.is_admin ? dt("Админ", "Admin") : dt("Участник", "Member")}
          </div>
        </div>
      </div>
    </nav>
  );
}

// Поле поиска над разделами (стенд: .search в .nav; решение владельца 2026-09-25 — «наверху,
// над столбцом вкладок надо добавить поле для поиска»). Enter задаёт вопрос базе — тот же
// ответ со ссылками на источники, что и на экране поиска; ⌘K / Ctrl+K ставит фокус в поле.
function RailSearch() {
  const dt = useDt();
  const { openAnswer } = useRoyNav();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

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

  const submit = () => {
    const v = q.trim();
    if (!v) return;
    saveRecent(v);
    openAnswer(v);
    setQ("");
    input.current?.blur();
  };

  return (
    <form role="search" className="px-2 pt-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label className="flex h-[30px] items-center gap-2 rounded-[7px] border border-line-2 bg-surface px-2.5 text-ink-mute transition-colors hover:border-ink-mute/40 focus-within:border-primary">
        <RoyIcon name="search" size={13} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }}
          placeholder={dt("Поиск", "Search")} aria-label={dt("Спросить базу", "Ask the knowledge base")}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute" style={{ fontSize: 12.5 }} />
        {!q && (
          <kbd className="rounded-[4px] border border-line-2 border-b-2 px-1 font-mono text-ink-mute" style={{ fontSize: 10 }}>⌘K</kbd>
        )}
      </label>
    </form>
  );
}
