"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, Panel,
  Handle, Position, getBezierPath,
  type Node, type Edge, type NodeProps, type EdgeProps, type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { Project, Task } from "@/types";
import { fetchTasks, updateTask, createTask } from "@/lib/api";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// ── палитра (globals.css) ──
const AMBER = "#D98A2B", AMBER_HI = "#F0B45F", DONE = "#2E9E6B", DONE_HI = "#52B98C", STONE = "#8C8475";
const stateOf = (t: Task): "done" | "active" => (t.status === "done" ? "done" : "active");

type TData = { label: string; kind: "root" | "task"; linked: boolean; state: "done" | "active" | "backlog"; emoji?: string | null };

// ── узел-модуль (warm tech-HUD) ──
function HudNode({ data, selected }: NodeProps) {
  const d = data as TData;
  const root = d.kind === "root";
  const backlog = d.state === "backlog";
  const done = d.state === "done";
  const accent = backlog ? STONE : done ? DONE : AMBER;
  const accentHi = backlog ? "#b7ae9e" : done ? DONE_HI : AMBER_HI;
  return (
    <div
      className="rf-hud"
      style={{
        position: "relative",
        minWidth: root ? 156 : 132,
        padding: root ? "12px 16px" : "9px 13px",
        borderRadius: root ? 13 : 11,
        background: backlog ? "rgba(34,26,16,0.72)" : "#221a10",
        border: `${root ? 2.2 : 1.6}px ${backlog ? "dashed" : "solid"} ${accent}`,
        color: backlog ? "#cbc2b1" : "#F2EDE3",
        font: `${root ? 800 : 600} ${root ? 15 : 12.5}px -apple-system,system-ui,sans-serif`,
        letterSpacing: "0.01em",
        boxShadow: backlog ? "none" : `0 0 ${root ? 26 : 16}px ${accentHi}${selected ? "aa" : "55"}, inset 0 0 14px ${accent}22`,
        display: "flex", alignItems: "center", gap: 9, whiteSpace: "nowrap",
        transition: "box-shadow .18s, transform .18s",
        cursor: "pointer",
      }}
    >
      {done ? (
        <svg width="15" height="15" viewBox="0 0 15 15" style={{ flex: "none" }}>
          <path d="M2.5 8 l3 3.5 l7 -8" fill="none" stroke={DONE_HI} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 3, background: accentHi, boxShadow: backlog ? "none" : `0 0 8px ${accentHi}`, flex: "none" }} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: root ? 190 : 150 }}>{d.label}</span>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

// ── ребро-жила: гравировка + светящаяся бегущая линия ──
function HudEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const done = (data as { state?: string } | undefined)?.state === "done";
  const col = done ? DONE : AMBER;
  return (
    <>
      <path d={path} fill="none" stroke="rgba(110,97,82,0.5)" strokeWidth={3.2} strokeLinecap="round" />
      <path className="rf-flow" d={path} fill="none" stroke={col} strokeWidth={1.7} strokeLinecap="round"
        strokeDasharray="2 8" style={{ filter: `drop-shadow(0 0 4px ${col})` }} />
    </>
  );
}

const nodeTypes = { hud: HudNode };
const edgeTypes = { hud: HudEdge };

const ROOT_ID = "__root__";
type LayoutRow = { id: string; parentId?: string; task: Task | null; hub: boolean };

// d3-hierarchy радиальная раскладка привязанного дерева.
function layoutTree(project: Project, linked: Task[]): { nodes: Node[]; edges: Edge[]; maxR: number } {
  const rows: LayoutRow[] = [{ id: ROOT_ID, parentId: undefined, task: null, hub: true }];
  const linkedIds = new Set(linked.map((t) => t.id));
  linked.forEach((t) => {
    const parentId = t.parent_id && linkedIds.has(t.parent_id) ? t.parent_id : ROOT_ID;
    rows.push({ id: t.id, parentId, task: t, hub: false });
  });
  const root = stratify<LayoutRow>().id((d) => d.id).parentId((d) => d.parentId)(rows);
  const maxDepth = root.height;
  const maxR = Math.max(220, maxDepth * 210);
  const laid = tree<LayoutRow>()
    .size([2 * Math.PI, maxR])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.7) / Math.max(1, a.depth))(root);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  laid.each((n: HierarchyPointNode<LayoutRow>) => {
    const angle = n.x - Math.PI / 2, radius = n.y;
    const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius;
    const row = n.data;
    if (row.hub) {
      nodes.push({ id: ROOT_ID, type: "hud", position: { x: px, y: py }, draggable: false,
        data: { label: project.name, kind: "root", linked: true, state: "active", emoji: project.emoji } });
    } else if (row.task) {
      nodes.push({ id: row.task.id, type: "hud", position: { x: px, y: py },
        data: { label: row.task.title, kind: "task", linked: true, state: stateOf(row.task) } });
      const pid = n.parent?.data.id ?? ROOT_ID;
      edges.push({ id: `e-${pid}-${row.task.id}`, source: pid, target: row.task.id, type: "hud",
        data: { state: stateOf(row.task) } });
    }
  });
  return { nodes, edges, maxR };
}

type Props = { project: Project; onBack: () => void };

export function ProjectTree({ project, onBack }: Props) {
  const dt = useDt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);

  const load = useCallback(async () => setTasks(await fetchTasks({ project_id: project.id })), [project.id]);
  useEffect(() => { void load(); }, [load]);

  const linked = useMemo(() => tasks.filter((t) => t.project_linked), [tasks]);
  const backlog = useMemo(() => tasks.filter((t) => !t.project_linked), [tasks]);

  const { nodes, edges, maxR } = useMemo(() => {
    const base = layoutTree(project, linked);
    // бэклог — колонка справа от дерева
    const bx = base.maxR + 300;
    backlog.forEach((t, i) => {
      base.nodes.push({ id: t.id, type: "hud", position: { x: bx, y: i * 76 - (backlog.length - 1) * 38 },
        data: { label: t.title, kind: "task", linked: false, state: "backlog" } });
    });
    return base;
  }, [project, linked, backlog]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    if (node.id === ROOT_ID) return;
    setOpenId(node.id);
  }, []);

  // drag-to-attach: бросил узел рядом с другим → делаем его подзадачей; в зону бэклога справа → отвязка.
  const onNodeDragStop: OnNodeDrag = useCallback((_e, node) => {
    if (node.id === ROOT_ID) return;
    const dropped = node.position;
    // ближайший потенциальный родитель (узел дерева или корень) в радиусе
    let target: { id: string } | null = null; let best = 90 * 90;
    for (const n of nodes) {
      if (n.id === node.id) continue;
      const nd = n.data as TData;
      if (nd.state === "backlog") continue; // родитель должен быть в дереве
      const dx = n.position.x - dropped.x, dy = n.position.y - dropped.y, d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; target = { id: n.id }; }
    }
    const cur = tasks.find((t) => t.id === node.id);
    if (!cur) return;
    if (target) {
      const parent_id = target.id === ROOT_ID ? null : target.id;
      if (cur.project_linked && (cur.parent_id ?? null) === parent_id) { void load(); return; }
      setTasks((prev) => prev.map((t) => (t.id === node.id ? { ...t, project_linked: true, parent_id } : t)));
      updateTask(node.id, { project_linked: true, parent_id }).then(load).catch(load);
    } else if (dropped.x > maxR + 180 && cur.project_linked) {
      // отвязка в бэклог
      setTasks((prev) => prev.map((t) => (t.id === node.id ? { ...t, project_linked: false, parent_id: null } : t)));
      updateTask(node.id, { project_linked: false, parent_id: null }).then(load).catch(load);
    } else {
      void load(); // вернуть на место (раскладка пересчитается)
    }
  }, [nodes, tasks, maxR, load]);

  const openTask = tasks.find((t) => t.id === openId);

  return (
    <div className="relative flex-1 min-h-0">
      <button onClick={onBack} className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2">
        <RoyIcon name="cleft" size={14} /> {dt("Проекты", "Projects")}
      </button>
      <button onClick={() => setCreating({ parentId: null })} className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white active:scale-95">
        <RoyIcon name="plus" size={14} /> {dt("Идея", "Idea")}
      </button>

      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 100% at 50% 42%, #211a12 0%, #171209 55%, #100c08 100%)" }}>
        {/* тёплое гало за корнем */}
        <div style={{ position: "absolute", left: "50%", top: "44%", width: 620, height: 620, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(217,138,43,0.10), transparent 65%)", pointerEvents: "none" }} />
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodeClick={onNodeClick} onNodeDragStop={onNodeDragStop}
          fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.3} maxZoom={2.4}
          proOptions={{ hideAttribution: true }} nodesConnectable={false}
        >
          <Background variant={BackgroundVariant.Lines} gap={44} color="rgba(235,211,162,0.05)" />
          <Controls showInteractive={false} />
          {backlog.length > 0 && (
            <Panel position="top-center"><span style={{ fontSize: 11, color: "#A89F90" }}>{dt("Бэклог справа → перетащи узел к дереву, чтобы привязать", "Backlog on the right → drag a node onto the tree to attach")}</span></Panel>
          )}
        </ReactFlow>
      </div>

      {openTask && <TaskModal task={openTask} open onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void load(); }} />}
      {creating && <TaskModal open prefill={{}} projectId={project.id} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); void load(); }} />}
    </div>
  );
}
