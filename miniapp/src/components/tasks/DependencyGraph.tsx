"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchTasks, fetchDependencies } from "@/lib/api";
import type { Task, TaskDependency } from "@/types";
import { statusColor } from "@/lib/timeline";

const NODE_W = 180;
const NODE_H = 56;
const COL_GAP = 220;
const ROW_GAP = 88;
const PAD = 24;

type Positioned = { task: Task; x: number; y: number };

// Раскладка по слоям: depends_on_id (блокер) левее, task_id правее.
function layout(nodeIds: string[], blocks: TaskDependency[], taskMap: Map<string, Task>): Map<string, Positioned> {
  const level = new Map<string, number>();
  nodeIds.forEach((id) => level.set(id, 0));
  for (let iter = 0; iter < nodeIds.length; iter++) {
    let changed = false;
    for (const e of blocks) {
      const want = (level.get(e.depends_on_id) ?? 0) + 1;
      if (want > (level.get(e.task_id) ?? 0)) { level.set(e.task_id, want); changed = true; }
    }
    if (!changed) break;
  }
  const rowsByLevel = new Map<number, number>();
  const pos = new Map<string, Positioned>();
  for (const id of nodeIds) {
    const task = taskMap.get(id);
    if (!task) continue;
    const lv = level.get(id) ?? 0;
    const row = rowsByLevel.get(lv) ?? 0;
    rowsByLevel.set(lv, row + 1);
    pos.set(id, { task, x: PAD + lv * COL_GAP, y: PAD + row * ROW_GAP });
  }
  return pos;
}

const EDGE_STYLE: Record<string, { dash: string; color: string }> = {
  blocks:     { dash: "0",   color: "oklch(0.6 0.2 25)" },
  relates_to: { dash: "6 4", color: "oklch(0.62 0.19 264)" },
  duplicates: { dash: "2 4", color: "oklch(0.6 0.02 0)" },
};

export function DependencyGraph() {
  const [edges, setEdges] = useState<TaskDependency[]>([]);
  const [taskMap, setTaskMap] = useState<Map<string, Task>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const tasks = await fetchTasks();
      const map = new Map(tasks.map((t) => [t.id, t] as const));
      // Собираем уникальные рёбра по всем задачам (дедуп по id ребра).
      const per = await Promise.all(tasks.map((t) => fetchDependencies(t.id).catch(() => [])));
      const seen = new Map<string, TaskDependency>();
      for (const list of per) for (const d of list) seen.set(d.id, d);
      setTaskMap(map);
      setEdges([...seen.values()]);
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка…</p>;

  if (edges.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Зависимостей пока нет. Свяжи задачи (X блокирует Y) — связи появятся здесь.
        </p>
      </div>
    );
  }

  const nodeIds = [...new Set(edges.flatMap((e) => [e.task_id, e.depends_on_id]))]
    .filter((id) => taskMap.has(id));
  const blocks = edges.filter((e) => e.dependency_type === "blocks");
  const pos = layout(nodeIds, blocks, taskMap);

  const maxX = Math.max(...[...pos.values()].map((p) => p.x), 0) + NODE_W + PAD;
  const maxY = Math.max(...[...pos.values()].map((p) => p.y), 0) + NODE_H + PAD;

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-4 pb-2 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Граф зависимостей</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {nodeIds.length} задач · {edges.length} связей
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        <svg width={maxX} height={maxY} className="block">
          <defs>
            {Object.entries(EDGE_STYLE).map(([k, s]) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
              </marker>
            ))}
          </defs>

          {/* рёбра: от блокера (depends_on_id, правый край) к заблокированной (task_id, левый край) */}
          {edges.map((e) => {
            const from = pos.get(e.depends_on_id);
            const to = pos.get(e.task_id);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
            const x2 = to.x, y2 = to.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const style = EDGE_STYLE[e.dependency_type] ?? EDGE_STYLE.blocks;
            return (
              <path key={e.id} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none" stroke={style.color} strokeWidth={1.5} strokeDasharray={style.dash}
                markerEnd={`url(#arrow-${e.dependency_type})`} />
            );
          })}

          {/* узлы */}
          {[...pos.values()].map(({ task, x, y }) => {
            const c = statusColor(task.status);
            return (
              <g key={task.id}>
                <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={10}
                  fill="var(--card)" stroke={c.bar} strokeWidth={2} />
                <rect x={x} y={y} width={4} height={NODE_H} rx={2} fill={c.bar} />
                <text x={x + 14} y={y + 22} fontSize={12} fontWeight={600} fill="var(--foreground)">
                  {task.title.length > 22 ? task.title.slice(0, 21) + "…" : task.title}
                </text>
                <text x={x + 14} y={y + 40} fontSize={10} fill="var(--muted-foreground)">
                  {task.status}{task.assignees.length ? ` · ${task.assignees[0]}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* легенда */}
      <div className="flex gap-4 px-5 py-2 border-t border-border text-[11px] text-muted-foreground shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-4 h-px" style={{ background: EDGE_STYLE.blocks.color }} />блокирует</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-px border-t border-dashed" style={{ borderColor: EDGE_STYLE.relates_to.color }} />связана</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-px border-t border-dotted" style={{ borderColor: EDGE_STYLE.duplicates.color }} />дубль</span>
      </div>
    </div>
  );
}
