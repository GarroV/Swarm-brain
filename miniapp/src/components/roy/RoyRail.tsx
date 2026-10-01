"use client";
import { useEffect, useRef, useState } from "react";
import { cn, displayName } from "@/lib/utils";
import { fetchConfig } from "@/lib/api";
import { Avatar } from "./ui";
import { RoyIcon, type RoyIconName } from "./icons";
import { initials } from "./dash/shared";
import { useDt, useRoyNav } from "./nav";
import { saveRecent } from "./screens/SearchScreen";
import { FeedbackDialog } from "./FeedbackFab";
import { readTheme, saveTheme, THEME_CHANGE_EVENT, THEME_IDS, type ThemeId } from "@/lib/theme";

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
  | "stats"
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
  { id: "stats", label: ["Статистика", "Stats"], icon: "graph" },
];

const FOOT: RailItem[] = [
  { id: "settings", label: ["Настройки", "Settings"], icon: "sliders" },
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
        title={dt(item.label[0], item.label[1])}
        className={cn(
          "relative flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left max-[1099px]:justify-center max-[1099px]:px-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          on
            ? "bg-accent-soft font-semibold text-accent-ink shadow-[inset_2px_0_0_var(--primary),var(--glow-sm)]"
            : "text-ink-soft hover:bg-surface hover:text-ink",
        )}
        style={{ fontSize: 13.5 }}
      >
        <RoyIcon name={item.icon} size={16} strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate max-[1099px]:hidden">{dt(item.label[0], item.label[1])}</span>
        {badge > 0 && (
          // Счётчик по стенду — тихой серой цифрой, не синей плашкой (визуальный шаг В2). В узкой
          // рейке — мелкой цифрой в углу пиктограммы.
          <span className="font-mono text-ink-mute max-[1099px]:absolute max-[1099px]:right-1 max-[1099px]:top-0.5" style={{ fontSize: 11 }}>
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label={dt("Разделы", "Sections")}
      // Уже 1100px рейка сворачивается в пиктограммы (56px): десктопная раскладка тянется до
      // 720px, а 216px рейки на таком окне съели бы треть экрана. Подписи — в title.
      className="roy-rail flex w-[216px] shrink-0 flex-col border-r border-line bg-surface-2 max-[1099px]:w-[56px]"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 max-[1099px]:justify-center max-[1099px]:px-0">
        {/* Бренд-блок: знак — тот же файл, что фавикон (циановый неон), и имя капсом. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный SVG из app/icon.svg, оптимизатор не нужен */}
        <img src="/icon.svg" alt="" aria-hidden width={28} height={28} className="size-7 shrink-0" />
        <span className="flex min-w-0 flex-col max-[1099px]:hidden">
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
        <ThemeSwitch />
        <FootTools items={foot} active={active} onSelect={onSelect} />
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5 max-[1099px]:justify-center max-[1099px]:px-0"
        title={displayName(me?.name) || undefined}>
        <Avatar size={26}>{initials(me?.name)}</Avatar>
        <div className="min-w-0 max-[1099px]:hidden">
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
    // В узкой рейке — пиктограмма; фокус (клик или ⌘K) раскрывает поле поверх экрана.
    <form role="search" className="relative px-2 pt-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label title={dt("Поиск · ⌘K", "Search · ⌘K")}
        className="group/rs flex h-[30px] items-center gap-2 rounded-[7px] border border-line-2 bg-surface px-2.5 text-ink-mute transition-colors hover:border-ink-mute/40 focus-within:border-primary max-[1099px]:justify-center max-[1099px]:px-0 max-[1099px]:focus-within:absolute max-[1099px]:focus-within:left-2 max-[1099px]:focus-within:z-50 max-[1099px]:focus-within:w-[260px] max-[1099px]:focus-within:justify-start max-[1099px]:focus-within:px-2.5 max-[1099px]:focus-within:shadow-lg">
        <RoyIcon name="search" size={13} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }}
          placeholder={dt("Поиск", "Search")} aria-label={dt("Спросить базу", "Ask the knowledge base")}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute max-[1099px]:w-0 max-[1099px]:flex-none max-[1099px]:group-focus-within/rs:w-auto max-[1099px]:group-focus-within/rs:flex-1" style={{ fontSize: 12.5 }} />
        {!q && (
          <kbd className="max-[1099px]:hidden rounded-[4px] border border-line-2 border-b-2 px-1 font-mono text-ink-mute" style={{ fontSize: 10 }}>⌘K</kbd>
        )}
      </label>
    </form>
  );
}

// Настройки, админка и фидбек — строкой пиктограмм под темой, тем же квадратом 28px, что и
// кнопки темы (просьба владельца 01.10.2026: «сделай кнопки админки, настроек и фидбека
// пиктограммами»). Подписи — в title и aria-label. В узкой рейке строка встаёт столбцом
// кнопок во всю ширину, как остальные пункты. Фидбек здесь, а не плавающей кнопкой: в узкой
// раскладке (720–1100px) кнопка в углу закрывала кнопки строк (найдено краулером на 800px).
const FOOT_TOOL =
  "grid size-[28px] place-items-center rounded-[7px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-[1099px]:h-[34px] max-[1099px]:w-full max-[1099px]:rounded-[8px]";
const FOOT_IDLE = "text-ink-mute hover:bg-surface hover:text-ink";

function FootTools({ items, active, onSelect }: {
  items: RailItem[];
  active: RailId | null;
  onSelect: (id: RailId) => void;
}) {
  const dt = useDt();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedback = dt("Фидбек", "Feedback");
  return (
    <div className="flex items-center justify-end gap-1 px-1 max-[1099px]:flex-col max-[1099px]:gap-0.5 max-[1099px]:px-0">
      {items.map((item) => {
        const on = active === item.id;
        const label = dt(item.label[0], item.label[1]);
        return (
          <button key={item.id} type="button" onClick={() => onSelect(item.id)}
            aria-current={on ? "page" : undefined} title={label} aria-label={label}
            className={cn(FOOT_TOOL, on ? "bg-accent-soft text-accent-ink" : FOOT_IDLE)}>
            <RoyIcon name={item.icon} size={15} strokeWidth={1.7} />
          </button>
        );
      })}
      <button type="button" onClick={() => setFeedbackOpen(true)} title={feedback} aria-label={feedback}
        className={cn(FOOT_TOOL, FOOT_IDLE)}>
        <RoyIcon name="feedback" size={15} strokeWidth={1.7} />
      </button>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}

// Переключатель темы над «Настройками» (решение владельца 2026-09-25). Широкая рейка — три кнопки
// «системная / светлая / тёмная», узкая (пиктограммы) — одна кнопка, листающая по кругу.
const THEME_LABEL: Record<ThemeId, [string, string]> = {
  system: ["Как в системе", "System"], light: ["Светлая", "Light"], dark: ["Тёмная", "Dark"],
};
const THEME_ICON: Record<ThemeId, RoyIconName> = { system: "monitor", light: "sun", dark: "moon" };

function ThemeSwitch() {
  const dt = useDt();
  const [theme, setTheme] = useState<ThemeId>("system");

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    // Смену темы ОС при «как в системе» ловит инлайн-скрипт layout.tsx (он читает тот же ключ).
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  const pick = (t: ThemeId) => { saveTheme(t); setTheme(t); };
  const next = THEME_IDS[(THEME_IDS.indexOf(theme) + 1) % THEME_IDS.length];

  return (
    <>
      <div role="radiogroup" aria-label={dt("Тема", "Theme")}
        className="mb-1 flex items-center gap-1 px-1 max-[1099px]:hidden">
        <span className="flex-1 text-ink-mute" style={{ fontSize: 12 }}>{dt("Тема", "Theme")}</span>
        {THEME_IDS.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={theme === t}
            title={dt(...THEME_LABEL[t])} aria-label={dt(...THEME_LABEL[t])} onClick={() => pick(t)}
            className={cn(
              "grid size-[28px] place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              theme === t ? "bg-accent-soft text-accent-ink" : "text-ink-mute hover:bg-surface hover:text-ink",
            )}>
            <RoyIcon name={THEME_ICON[t]} size={15} strokeWidth={1.7} />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => pick(next)}
        title={`${dt("Тема", "Theme")}: ${dt(...THEME_LABEL[theme])}`}
        aria-label={`${dt("Тема", "Theme")}: ${dt(...THEME_LABEL[theme])}`}
        className="hidden h-[34px] w-full items-center justify-center rounded-full text-ink-soft hover:bg-surface hover:text-ink max-[1099px]:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <RoyIcon name={THEME_ICON[theme]} size={16} strokeWidth={1.7} />
      </button>
    </>
  );
}
