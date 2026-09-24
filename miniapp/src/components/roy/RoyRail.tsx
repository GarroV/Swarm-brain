"use client";
import { cn, displayName } from "@/lib/utils";
import { Avatar } from "./ui";
import { RoyIcon, type RoyIconName } from "./icons";
import { initials } from "./dash/shared";
import { useDt, useRoyNav } from "./nav";

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
        <span className="font-bold text-ink" style={{ fontSize: 13.5, letterSpacing: "0.04em" }}>
          SWARM
        </span>
      </div>
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
