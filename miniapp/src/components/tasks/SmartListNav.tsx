"use client";
import { cn } from "@/lib/utils";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { SMART_LISTS, type SmartListId } from "@/lib/smartLists";

type SmartListNavProps = {
  variant: "rail" | "chips";
  /** Только chips: без внешних отступов и с затуханием справа — для строки рядом с чипом линзы. */
  compact?: boolean;
  active: SmartListId;
  counts: Record<SmartListId, number>;
  onSelect: (id: SmartListId) => void;
  /** Только rail: локальный поиск по заголовку. */
  query?: string;
  onQuery?: (q: string) => void;
  // Пункт «Все сотрудники» в рельсе УДАЛЁН 2026-08-20 (владелец: «в двух местах, левые можно
  // убрать»): тот же тумблер живёт чипом в шапке экрана (`LensToggle`, только админу) — там он
  // рядом с «По рынкам», с которым и работает в паре. Два входа в одно состояние путали.
  /** Только rail: персональные списки-метки. */
  labels?: { id: string; name: string; icon: string }[];
  labelCounts?: Record<string, number>;
  activeLabelId?: string | null;
  onSelectLabel?: (id: string) => void;
  onCreateLabel?: () => void;
  /** Только rail: открыть редактор списка (переименовать/удалить). */
  onEditLabel?: (label: { id: string; name: string; icon: string }) => void;
};

// Навигация по смарт-спискам: вертикальный рельс (десктоп) или горизонтальные чипы (мобайл).
export function SmartListNav({ variant, compact, active, counts, onSelect, query, onQuery, labels, labelCounts, activeLabelId, onSelectLabel, onCreateLabel, onEditLabel }: SmartListNavProps) {
  if (variant === "chips") {
    // Затухание справа (mask, не градиент-подложка) — единственный честный намёк, что чипы
    // скроллятся: раньше четвёртый чип просто обрубался краем экрана и выглядел сломанным.
    // Маска работает поверх любого фона, включая галактику тёмной темы.
    return (
      <div
        className={cn(
          "flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          compact ? "[mask-image:linear-gradient(to_right,black_calc(100%-22px),transparent)]" : "px-5 pb-3",
        )}
      >
        {SMART_LISTS.map(({ id, label, icon }) => {
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold transition-colors",
                on ? "bg-primary text-white" : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
              )}
              // Тач-цель: чипы — основная навигация по списку, были 31px при норме 44.
              style={{ fontSize: 12.5, minHeight: 40 }}
            >
              <RoyIcon name={icon} size={13} strokeWidth={2} />
              {label}
              {counts[id] > 0 && (
                <span className={`font-mono ${on ? "text-white/80" : "text-ink-mute"}`} style={{ fontSize: 11 }}>
                  {counts[id]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-line px-3 py-4">
      {onQuery && (
        <label className="mb-2 flex items-center gap-2 rounded-[10px] border border-line-2 bg-surface px-2.5 py-1.5 text-ink-soft">
          <RoyIcon name="search" size={14} />
          <input
            value={query ?? ""}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск"
            className="w-full bg-transparent outline-none placeholder:text-ink-mute"
            style={{ fontSize: 13 }}
          />
        </label>
      )}
      {SMART_LISTS.map(({ id, label, icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors",
              on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface",
            )}
            style={{ fontSize: 13.5 }}
          >
            <RoyIcon name={icon} size={16} strokeWidth={on ? 2.1 : 1.8} />
            <span className="flex-1 text-left">{label}</span>
            {counts[id] > 0 && (
              <span className={`font-mono ${on ? "text-accent-ink" : "text-ink-mute"}`} style={{ fontSize: 11.5 }}>
                {counts[id]}
              </span>
            )}
          </button>
        );
      })}

      {/* Персональные списки-метки (смарт-списки по метке). */}
      {onSelectLabel && labels && (
        <>
          <div className="my-1.5 border-t border-line" />
          <div className="px-2.5 pb-1 font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Мои списки</div>
          {labels.map((l) => {
            const on = activeLabelId === l.id;
            const count = labelCounts?.[l.id] ?? 0;
            return (
              <div key={l.id} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectLabel(l.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors",
                    on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface",
                  )}
                  style={{ fontSize: 13.5 }}
                >
                  <RoyIcon name={((l.icon as RoyIconName) || "tag")} size={16} strokeWidth={on ? 2.1 : 1.8} />
                  <span className="flex-1 truncate text-left">{l.name}</span>
                  {count > 0 && (
                    <span className={`shrink-0 font-mono ${on ? "text-accent-ink" : "text-ink-mute"}`} style={{ fontSize: 11.5 }}>{count}</span>
                  )}
                </button>
                {onEditLabel && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditLabel(l); }}
                    aria-label={`Редактировать список «${l.name}»`}
                    className="flex shrink-0 items-center justify-center rounded-[8px] p-1.5 text-ink-mute opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink-soft group-hover/row:opacity-100"
                  >
                    <RoyIcon name="dots" size={15} strokeWidth={1.9} />
                  </button>
                )}
              </div>
            );
          })}
          {onCreateLabel && (
            <button
              type="button"
              onClick={onCreateLabel}
              className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface"
              style={{ fontSize: 13.5 }}
            >
              <RoyIcon name="plus" size={16} strokeWidth={2} />
              <span className="flex-1 text-left">Новый список</span>
            </button>
          )}
        </>
      )}
    </aside>
  );
}
