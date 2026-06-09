"use client";
import { useState } from "react";
import { LayoutGrid, GanttChartSquare, Columns3, Share2 } from "lucide-react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TimelineView } from "@/components/tasks/TimelineView";
import { SprintBoard } from "@/components/tasks/SprintBoard";
// R-9: import { DependencyGraph } from "@/components/tasks/DependencyGraph";

type View = "board" | "timeline" | "sprint" | "graph";

const VIEWS: Array<{ id: View; label: string; Icon: React.FC<{ className?: string }> }> = [
  { id: "board", label: "Доска", Icon: LayoutGrid },
  { id: "timeline", label: "Таймлайн", Icon: GanttChartSquare },
  { id: "sprint", label: "Спринт", Icon: Columns3 },
  { id: "graph", label: "Граф", Icon: Share2 },
];

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <p className="text-sm text-muted-foreground">{title} — скоро.</p>
    </div>
  );
}

export function TasksScreen() {
  const [view, setView] = useState<View>("board");

  return (
    <div className="flex flex-col h-full">
      {/* Editorial-переключатель видов */}
      <div className="flex gap-1 px-3 pt-3 pb-2 overflow-x-auto shrink-0">
        {VIEWS.map(({ id, label, Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {view === "board" && <KanbanBoard />}
        {view === "timeline" && <TimelineView />}
        {view === "sprint" && <SprintBoard />}
        {view === "graph" && <Placeholder title="Граф зависимостей" />}
      </div>
    </div>
  );
}
