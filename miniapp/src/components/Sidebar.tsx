"use client";
import { navItems, type Section } from "@/components/BottomNav";
import { cn } from "@/lib/utils";

interface SidebarProps {
  active: Section;
  onChange: (s: Section) => void;
  isAdmin?: boolean;
  className?: string;
}

// Десктопный сайдбар (≥lg). На мобиле скрыт — там нижний таб-бар.
export function Sidebar({ active, onChange, isAdmin = false, className }: SidebarProps) {
  const items = navItems(isAdmin);
  return (
    <aside className={cn("w-60 shrink-0 border-r border-border bg-sidebar flex flex-col", className)}>
      <div className="px-5 h-14 flex items-center gap-2 border-b border-border">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          Р
        </span>
        <span className="font-semibold text-base">Рой</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
