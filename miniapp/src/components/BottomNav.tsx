"use client";
import { ClipboardList, BookOpen, CalendarDays, Users, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type Section = "tasks" | "knowledge" | "meetings" | "team" | "settings" | "admin";

export interface NavItem {
  id: Section;
  label: string;
  Icon: React.FC<{ className?: string }>;
}

// Единый источник пунктов навигации для нижнего таб-бара (мобила) и сайдбара (десктоп).
export function navItems(isAdmin: boolean): NavItem[] {
  return [
    { id: "tasks", label: "Задачи", Icon: ClipboardList },
    { id: "knowledge", label: "База", Icon: BookOpen },
    { id: "meetings", label: "Встречи", Icon: CalendarDays },
    { id: "team", label: "Команда", Icon: Users },
    { id: "settings", label: "Настройки", Icon: Settings },
    ...(isAdmin ? [{ id: "admin" as const, label: "Админ", Icon: ShieldCheck }] : []),
  ];
}

interface BottomNavProps {
  active: Section;
  onChange: (s: Section) => void;
  isAdmin?: boolean;
  className?: string;
}

export function BottomNav({ active, onChange, isAdmin = false, className }: BottomNavProps) {
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border h-16 flex",
        className,
      )}
    >
      {navItems(isAdmin).map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
            active === id ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="w-5 h-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}
