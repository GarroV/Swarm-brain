"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, Panel,
  Handle, Position, getStraightPath, useNodesState, useEdgesState,
  useInternalNode, ConnectionMode,
  type Node, type Edge, type NodeProps, type EdgeProps, type NodeMouseHandler,
  type Connection, type OnNodeDrag, type InternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { Project, Task } from "@/types";
import { fetchTasks, updateTask } from "@/lib/api";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

const AMBER = "#D98A2B", AMBER_HI = "#F0B45F", DONE = "#2E9E6B", DONE_HI = "#52B98C", STONE = "#8C8475";
const ROOT_ID = "__root__";
const stateOf = (t: Task): "done" | "active" => (t.status === "done" ? "done" : "active");

type TData = { label: string; kind: "root" | "task"; state: "done" | "active" | "backlog" };

// ── компактный узел-модуль ──
function HudNode({ data, selected }: NodeProps) {
  const d = data as TData;
  const root = d.kind === "root";
  const backlog = d.state === "backlog";
  const done = d.state === "done";
  const accent = backlog ? STONE : done ? DONE : AMBER;
  const accentHi = backlog ? "#b7ae9e" : done ? DONE_HI : AMBER_HI;
  // хэндлы на 4 сторонах: связь можно начать/принять с любой стороны (ConnectionMode.Loose);
  // floating-ребро само выберет ближнюю грань. Мелкие точки на границе, тело остаётся тащимым.
  const hs = { width: 8, height: 8, background: accent, border: "none", opacity: 0.5 } as const;
  const sides: Array<[string, Position]> = [["t", Position.Top], ["r", Position.Right], ["b", Position.Bottom], ["l", Position.Left]];
  return (
    <div
      className="rf-hud"
      style={{
        position: "relative",
        maxWidth: 168,
        padding: root ? "6px 11px" : "5px 9px",
        borderRadius: 8,
        background: backlog ? "rgba(34,26,16,0.72)" : "#221a10",
        border: `${root ? 1.8 : 1.3}px ${backlog ? "dashed" : "solid"} ${accent}`,
        color: backlog ? "#cbc2b1" : "#F2EDE3",
        font: `${root ? 700 : 600} ${root ? 12.5 : 11}px -apple-system,system-ui,sans-serif`,
        boxShadow: backlog ? "none" : `0 0 ${root ? 14 : 9}px ${accentHi}${selected ? "99" : "44"}`,
        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        transition: "box-shadow .16s",
      }}
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 15 15" style={{ flex: "none" }}><path d="M2.5 8 l3 3.5 l7 -8" fill="none" stroke={DONE_HI} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <span style={{ width: 6, height: 6, borderRadius: 2, background: accentHi, boxShadow: backlog ? "none" : `0 0 6px ${accentHi}`, flex: "none" }} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
      {sides.map(([id, pos]) => (
        <Handle key={id} id={id} type="source" position={pos} style={hs} isConnectableStart isConnectableEnd />
      ))}
    </div>
  );
}

// ── floating-геометрия: точка пересечения линии центров с границей узла ──
function nodeCenter(n: InternalNode) {
  const p = n.internals.positionAbsolute;
  return { x: p.x + (n.measured?.width ?? 0) / 2, y: p.y + (n.measured?.height ?? 0) / 2 };
}
function intersect(n: InternalNode, other: InternalNode) {
  const w = (n.measured?.width ?? 0) / 2, h = (n.measured?.height ?? 0) / 2;
  if (!w || !h) return nodeCenter(n);
  const c = nodeCenter(n), o = nodeCenter(other);
  const x1 = (o.x - c.x) / (2 * w) - (o.y - c.y) / (2 * h);
  const y1 = (o.x - c.x) / (2 * w) + (o.y - c.y) / (2 * h);
  const a = 1 / (Math.abs(x1) + Math.abs(y1) || 1);
  const xx = a * x1, yy = a * y1;
  return { x: w * (xx + yy) + c.x, y: h * (-xx + yy) + c.y };
}

// ── прямое floating ребро-жила (выходит с ближней грани) ──
function HudEdge({ source, target, data }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = intersect(s, t), b = intersect(t, s);
  const [path] = getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y });
  const done = (data as { state?: string } | undefined)?.state === "done";
  const col = done ? DONE : AMBER;
  return (
    <>
      <path d={path} fill="none" stroke="rgba(110,97,82,0.5)" strokeWidth={2.6} strokeLinecap="round" />
      <path className="rf-flow" d={path} fill="none" stroke={col} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="2 8" style={{ filter: `drop-shadow(0 0 3px ${col})` }} />
    </>
  );
}

const nodeTypes = { hud: HudNode };
const edgeTypes = { hud: HudEdge };

type Row = { id: string; parentId?: string; task: Task | null; hub: boolean };
// начальная авто-раскладка (сверху-вниз) — только для узлов без сохранённой позиции
function seedPositions(project: Project, linked: Task[], saved: Map<string, { x: number; y: number }>): Map<string, { x: number; y: number }> {
  const out = new Map(saved);
  const rows: Row[] = [{ id: ROOT_ID, task: null, hub: true }];
  const ids = new Set(linked.map((t) => t.id));
  linked.forEach((t) => rows.push({ id: t.id, parentId: t.parent_id && ids.has(t.parent_id) ? t.parent_id : ROOT_ID, task: t, hub: false }));
  try {
    const h = stratify<Row>().id((d) => d.id).parentId((d) => d.parentId)(rows);
    tree<Row>().nodeSize([150, 96])(h).each((n: HierarchyPointNode<Row>) => {
      if (!out.has(n.data.id)) out.set(n.data.id, { x: n.x, y: n.y });
    });
  } catch { /* пустое/битое дерево — корень в центре */ if (!out.has(ROOT_ID)) out.set(ROOT_ID, { x: 0, y: 0 }); }
  return out;
}

type Props = { project: Project; onBack: () => void };

export function ProjectTree({ project, onBack }: Props) {
  const dt = useDt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map()); // ручные позиции (сессия)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const load = useCallback(async () => setTasks(await fetchTasks({ project_id: project.id })), [project.id]);
  useEffect(() => { void load(); }, [load]);

  // строим узлы/рёбра из задач, сохраняя ручные позиции
  useEffect(() => {
    const linked = tasks.filter((t) => t.project_linked);
    const backlog = tasks.filter((t) => !t.project_linked);
    const pos = seedPositions(project, linked, posRef.current);
    // бэклог — колонка справа, если ещё без позиции
    const maxX = Math.max(0, ...[...pos.values()].map((p) => p.x));
    backlog.forEach((t, i) => { if (!pos.has(t.id)) pos.set(t.id, { x: maxX + 260, y: i * 60 - (backlog.length - 1) * 30 }); });
    posRef.current = pos;

    const ns: Node[] = [{ id: ROOT_ID, type: "hud", position: pos.get(ROOT_ID)!, draggable: true,
      data: { label: project.name, kind: "root", state: "active" } }];
    linked.forEach((t) => ns.push({ id: t.id, type: "hud", position: pos.get(t.id)!, data: { label: t.title, kind: "task", state: stateOf(t) } }));
    backlog.forEach((t) => ns.push({ id: t.id, type: "hud", position: pos.get(t.id)!, data: { label: t.title, kind: "task", state: "backlog" } }));
    setNodes(ns);

    const es: Edge[] = [];
    linked.forEach((t) => {
      const pid = t.parent_id && linked.some((x) => x.id === t.parent_id) ? t.parent_id : ROOT_ID;
      es.push({ id: `e-${pid}-${t.id}`, source: pid, target: t.id, type: "hud", data: { state: stateOf(t) } });
    });
    setEdges(es);
  }, [tasks, project, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => { if (node.id !== ROOT_ID) setOpenId(node.id); }, []);
  const onNodeDragStop: OnNodeDrag = useCallback((_e, node) => { posRef.current.set(node.id, node.position); }, []);

  // связать: протянул от родителя (source) к ребёнку (target) → target становится подзадачей source
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const child = c.target;
    const parent_id = c.source === ROOT_ID ? null : c.source;
    // защита от простого цикла: нельзя привязать к своему потомку
    const isDescendant = (a: string, of: string): boolean => {
      const kid = tasks.find((t) => t.id === a);
      if (!kid || !kid.parent_id) return false;
      return kid.parent_id === of || isDescendant(kid.parent_id, of);
    };
    if (parent_id && isDescendant(parent_id, child)) return;
    setTasks((prev) => prev.map((t) => (t.id === child ? { ...t, project_linked: true, parent_id } : t)));
    updateTask(child, { project_linked: true, parent_id }).then(load).catch(load);
  }, [tasks, load]);

  const openTask = tasks.find((t) => t.id === openId);
  const hasBacklog = useMemo(() => tasks.some((t) => !t.project_linked), [tasks]);

  return (
    <div className="relative flex-1 min-h-0">
      <button onClick={onBack} className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2">
        <RoyIcon name="cleft" size={14} /> {dt("Проекты", "Projects")}
      </button>
      <button onClick={() => setCreating(true)} className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white active:scale-95">
        <RoyIcon name="plus" size={14} /> {dt("Идея", "Idea")}
      </button>

      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 100% at 50% 42%, #211a12 0%, #171209 55%, #100c08 100%)" }}>
        <div style={{ position: "absolute", left: "50%", top: "44%", width: 560, height: 560, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(217,138,43,0.09), transparent 65%)", pointerEvents: "none" }} />
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick} onNodeDragStop={onNodeDragStop} onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.3} maxZoom={2.6}
          proOptions={{ hideAttribution: true }} connectionLineStyle={{ stroke: AMBER, strokeWidth: 1.5 }}
        >
          <Background variant={BackgroundVariant.Lines} gap={44} color="rgba(235,211,162,0.05)" />
          <Controls showInteractive={false} />
          {hasBacklog && (
            <Panel position="top-center"><span style={{ fontSize: 11, color: "#A89F90" }}>{dt("Тащи узлы как хочешь · протяни от узла к узлу — сделать подзадачей", "Drag nodes freely · pull from one node to another to make a subtask")}</span></Panel>
          )}
        </ReactFlow>
      </div>

      {openTask && <TaskModal task={openTask} open onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void load(); }} />}
      {creating && <TaskModal open prefill={{}} projectId={project.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
    </div>
  );
}
