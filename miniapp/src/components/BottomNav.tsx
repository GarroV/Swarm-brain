"use client";
import { ClipboardList, BookOpen, CalendarDays, Users, Settings, ShieldCheck } from "lucide-react";

export type Section = "tasks" | "knowledge" | "meetings" | "team" | "settings" | "admin";

interface BottomNavProps {
  active: Section;
  onChange: (s: Section) => void;
  isAdmin?: boolean;
}

export function BottomNav({ active, onChange, isAdmin = false }: BottomNavProps) {
  const TABS: Array<{ id: Section; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: "tasks", label: "Задачи", Icon: ClipboardList },
    { id: "knowledge", label: "База", Icon: BookOpen },
    { id: "meetings", label: "Встречи", Icon: CalendarDays },
    { id: "team", label: "Команда", Icon: Users },
    { id: "settings", label: "Ещё", Icon: Settings },
    ...(isAdmin ? [{ id: "admin" as const, label: "Админ", Icon: ShieldCheck }] : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border h-16 flex">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
            active === id ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <Icon className="w-5 h-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}
