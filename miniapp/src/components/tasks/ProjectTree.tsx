"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Panel,
  Handle, Position, getStraightPath, useNodesState, useEdgesState,
  useInternalNode, useReactFlow, ConnectionMode,
  type Node, type Edge, type NodeProps, type EdgeProps, type NodeMouseHandler,
  type Connection, type OnNodeDrag, type InternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";
import { edgeGap, windowedSpeed, type Rect } from "@/components/tasks/treeGeom";
import type { Project, Task } from "@/types";
import { fetchTasks, updateTask } from "@/lib/api";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

const AMBER = "#D98A2B", AMBER_HI = "#F0B45F", DONE = "#2E9E6B", DONE_HI = "#52B98C", STONE = "#8C8475";
const ROOT_ID = "__root__";
const stateOf = (t: Task): "done" | "active" => (t.status === "done" ? "done" : "active");

type TData = { label: string; kind: "root" | "task"; state: "done" | "active" | "backlog" };

// ── узел-модуль в духе нод-редактора DaVinci/Fusion: rounded-rect карточка,
// цветная акцент-полоса слева (категория/статус) вместо обвода-рамки и центрированной точки,
// чистое компактное тело. Прямые floating-рёбра (ниже) остаются — это отдельная, уже сведённая ось. ──
function HudNode({ data, selected }: NodeProps) {
  const d = data as TData;
  const root = d.kind === "root";
  const backlog = d.state === "backlog";
  const done = d.state === "done";
  const accent = backlog ? STONE : done ? DONE : AMBER;
  const accentHi = backlog ? "#b7ae9e" : done ? DONE_HI : AMBER_HI;
  // хэндлы на 4 сторонах: связь можно начать/принять с любой стороны (ConnectionMode.Loose);
  // floating-ребро само выберет ближнюю грань. Невидимые — без визуального мусора,
  // но остаются кликабельной зоной для ручного коннекта; основной способ — магнит-близость.
  const hs = { width: 10, height: 10, background: "transparent", border: "none", opacity: 0, minWidth: 0, minHeight: 0 } as const;
  const sides: Array<[string, Position]> = [["t", Position.Top], ["r", Position.Right], ["b", Position.Bottom], ["l", Position.Left]];
  const barW = root ? 4 : 3;
  return (
    <div
      className="rf-hud"
      style={{
        position: "relative",
        maxWidth: 176,
        borderRadius: 7,
        background: backlog ? "rgba(28,22,14,0.7)" : "#1c1610",
        border: `1px solid ${backlog ? "rgba(140,132,117,0.45)" : "rgba(0,0,0,0.5)"}`,
        boxShadow: selected
          ? `0 0 0 1.5px ${accentHi}, 0 2px 10px rgba(0,0,0,.45), 0 0 ${root ? 16 : 10}px ${accentHi}66`
          : `0 2px 8px rgba(0,0,0,.4)${backlog ? "" : `, 0 0 ${root ? 12 : 7}px ${accentHi}2e`}`,
        display: "flex", alignItems: "stretch", overflow: "hidden",
        transition: "box-shadow .16s",
      }}
    >
      {/* акцент-полоса: категория/статус — фирменный приём Fusion-нод */}
      <div style={{ width: barW, flex: "none", background: accent, opacity: backlog ? 0.55 : 1, backgroundImage: backlog ? "repeating-linear-gradient(180deg, transparent 0 4px, rgba(0,0,0,.5) 4px 6px)" : undefined }} />
      <div style={{
        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        padding: root ? "6px 10px 6px 8px" : "5px 8px 5px 7px",
        color: backlog ? "#a89f90" : "#F2EDE3",
        font: `${root ? 700 : 600} ${root ? "12.5px" : "11px"} -apple-system,system-ui,sans-serif`,
      }}>
        {done ? (
          <svg width="11" height="11" viewBox="0 0 15 15" style={{ flex: "none" }}><path d="M2.5 8 l3 3.5 l7 -8" fill="none" stroke={DONE_HI} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : !backlog ? (
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: accentHi, boxShadow: `0 0 5px ${accentHi}`, flex: "none" }} />
        ) : null}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
      </div>
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

// useReactFlow/useInternalNode требуют контекст ReactFlowProvider — оборачиваем.
export function ProjectTree(props: Props) {
  return <ReactFlowProvider><ProjectTreeInner {...props} /></ReactFlowProvider>;
}

function ProjectTreeInner({ project, onBack }: Props) {
  const dt = useDt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map()); // ручные позиции (сессия)
  // «сейчас-связался/сейчас-отвязался» — узел/ребро на секунду подсвечивается CSS-анимацией.
  const flashNodeRef = useRef<Map<string, "rf-pop" | "rf-off">>(new Map());
  const flashEdgeRef = useRef<Set<string>>(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const flash = useCallback((nodeId: string, cls: "rf-pop" | "rf-off", edgeId?: string) => {
    flashNodeRef.current.set(nodeId, cls);
    if (edgeId) flashEdgeRef.current.add(edgeId);
    setTimeout(() => {
      flashNodeRef.current.delete(nodeId);
      if (edgeId) flashEdgeRef.current.delete(edgeId);
      // снять класс точечно (без полной пересборки — данные задач уже стабильны к этому моменту)
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, className: undefined } : n)));
      if (edgeId) setEdges((prev) => prev.map((e) => (e.id === edgeId ? { ...e, className: undefined } : e)));
    }, 560);
  }, [setNodes, setEdges]);

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

    const cls = (id: string) => flashNodeRef.current.get(id);
    const ns: Node[] = [{ id: ROOT_ID, type: "hud", position: pos.get(ROOT_ID)!, draggable: true,
      className: cls(ROOT_ID), data: { label: project.name, kind: "root", state: "active" } }];
    linked.forEach((t) => ns.push({ id: t.id, type: "hud", position: pos.get(t.id)!, className: cls(t.id), data: { label: t.title, kind: "task", state: stateOf(t) } }));
    backlog.forEach((t) => ns.push({ id: t.id, type: "hud", position: pos.get(t.id)!, className: cls(t.id), data: { label: t.title, kind: "task", state: "backlog" } }));
    setNodes(ns);

    const es: Edge[] = [];
    linked.forEach((t) => {
      const pid = t.parent_id && linked.some((x) => x.id === t.parent_id) ? t.parent_id : ROOT_ID;
      const eid = `e-${pid}-${t.id}`;
      es.push({ id: eid, source: pid, target: t.id, type: "hud", className: flashEdgeRef.current.has(eid) ? "rf-edge-in" : undefined, data: { state: stateOf(t) } });
    });
    setEdges(es);
  }, [tasks, project, setNodes, setEdges]);

  const rf = useReactFlow();
  // Скорость движения в момент отпускания — просто отодвинуть карточку (медленно) НЕ рвёт связь,
  // рвёт только резкий рывок наружу. Иначе обычная перестановка вдалеке от родителя всё время отвязывала.
  const GAP_PX = 46; // порог «магнита»: зазор между ГРАНЯМИ карточек (не центрами — иначе крупный корень чувствуется «нерабочим»)
  const YANK_SPEED = 1.15; // px/мс, усреднённая по окну — см. onNodeDrag
  const VELOCITY_WINDOW_MS = 130; // окно усреднения скорости: гасит джиттер трекпада в последнем кадре перед отпусканием
  const speedRef = useRef(0);
  const sampleBufRef = useRef<Array<{ x: number; y: number; t: number }>>([]);

  // нельзя привязать к своему потомку (защита от цикла)
  const isDescendant = useCallback((a: string, of: string): boolean => {
    const kid = tasks.find((t) => t.id === a);
    if (!kid || !kid.parent_id) return false;
    return kid.parent_id === of || isDescendant(kid.parent_id, of);
  }, [tasks]);

  // ближайший узел к перетаскиваемому, по ЗАЗОРУ между гранями (edgeGap), с учётом запрета цикла
  const closest = useCallback((dragId: string, pos: { x: number; y: number }): Node | null => {
    const dragNode = rf.getNode(dragId);
    const dragRect: Rect = { x: pos.x, y: pos.y, w: dragNode?.measured?.width ?? 130, h: dragNode?.measured?.height ?? 34 };
    let best: Node | null = null, bestGap = GAP_PX;
    for (const o of rf.getNodes()) {
      if (o.id === dragId) continue;
      if ((o.data as TData).state === "backlog") continue; // цель — только узел в дереве
      if (o.id !== ROOT_ID && isDescendant(o.id, dragId)) continue;
      const gap = edgeGap(dragRect, { x: o.position.x, y: o.position.y, w: o.measured?.width ?? 130, h: o.measured?.height ?? 34 });
      if (gap < bestGap) { bestGap = gap; best = o; }
    }
    return best;
  }, [rf, isDescendant]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => { if (node.id !== ROOT_ID) setOpenId(node.id); }, []);

  const multiSelected = useCallback(() => rf.getNodes().filter((n) => n.selected).length > 1, [rf]);

  // во время перетаскивания — превью-связь к ближайшему (только для одиночного узла) + окно скорости
  const onNodeDrag: OnNodeDrag = useCallback((_e, node) => {
    const now = performance.now();
    const buf = sampleBufRef.current;
    buf.push({ x: node.position.x, y: node.position.y, t: now });
    while (buf.length > 1 && now - buf[0].t > VELOCITY_WINDOW_MS) buf.shift(); // храним только последние ~130мс
    speedRef.current = windowedSpeed(buf, VELOCITY_WINDOW_MS);

    if (node.id === ROOT_ID || multiSelected()) return;
    const near = closest(node.id, node.position);
    const cur = tasks.find((t) => t.id === node.id);
    const parentId = near ? (near.id === ROOT_ID ? null : near.id) : undefined;
    const already = cur && cur.project_linked && parentId !== undefined && (cur.parent_id ?? null) === parentId;
    setEdges((prev) => {
      const base = prev.filter((e) => e.id !== "__preview__");
      if (near && !already) base.push({ id: "__preview__", source: near.id, target: node.id, type: "hud", data: { state: "active" }, className: "rf-preview" });
      return base;
    });
  }, [closest, tasks, setEdges]);

  // отпустил: близко к узлу → коннект (подзадача); в пустоте → разрыв (в бэклог)
  const onNodeDragStop: OnNodeDrag = useCallback((_e, node) => {
    setEdges((prev) => prev.filter((e) => e.id !== "__preview__"));
    // групповое перемещение — только сохранить позиции, без магнита
    if (multiSelected()) { rf.getNodes().forEach((n) => { if (n.selected) posRef.current.set(n.id, n.position); }); return; }
    posRef.current.set(node.id, node.position);
    if (node.id === ROOT_ID) return;
    const cur = tasks.find((t) => t.id === node.id);
    if (!cur) return;
    const near = closest(node.id, node.position);
    const speed = speedRef.current;
    speedRef.current = 0; sampleBufRef.current = []; // сброс для следующего жеста
    if (near) {
      // связать — всегда охотно, без порога скорости (это желаемое действие, не защищаемое от случайности)
      const parent_id = near.id === ROOT_ID ? null : near.id;
      if (cur.project_linked && (cur.parent_id ?? null) === parent_id) return;
      flash(node.id, "rf-pop", `e-${near.id}-${node.id}`);
      setTasks((prev) => prev.map((t) => (t.id === node.id ? { ...t, project_linked: true, parent_id } : t)));
      updateTask(node.id, { project_linked: true, parent_id }).then(load).catch(load);
    } else if (cur.project_linked) {
      // не рядом ни с кем: рвём связь ТОЛЬКО на резком движении (рывок). Медленно отставил подальше
      // просто переставить карточку — связь держится, ребро тянется следом.
      if (speed < YANK_SPEED) return;
      flash(node.id, "rf-off");
      setTasks((prev) => prev.map((t) => (t.id === node.id ? { ...t, project_linked: false, parent_id: null } : t)));
      updateTask(node.id, { project_linked: false, parent_id: null }).then(load).catch(load);
    }
  }, [closest, tasks, load, setEdges, flash]);

  // групповое перетаскивание (выделенная рамкой группа) — сохранить позиции всех
  const onSelectionDragStop = useCallback((_e: React.MouseEvent, dragged: Node[]) => {
    dragged.forEach((n) => posRef.current.set(n.id, n.position));
  }, []);

  // ручное связывание: протянул от узла к узлу (край) → target становится подзадачей source
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const child = c.target;
    const parent_id = c.source === ROOT_ID ? null : c.source;
    if (parent_id && isDescendant(parent_id, child)) return;
    flash(child, "rf-pop", `e-${c.source}-${child}`);
    setTasks((prev) => prev.map((t) => (t.id === child ? { ...t, project_linked: true, parent_id } : t)));
    updateTask(child, { project_linked: true, parent_id }).then(load).catch(load);
  }, [isDescendant, load, flash]);

  const openTask = tasks.find((t) => t.id === openId);

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
          onNodeClick={onNodeClick} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
          onSelectionDragStop={onSelectionDragStop} onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          panOnScroll zoomOnScroll={false} selectionOnDrag panOnDrag={[1, 2]}
          // fitView сам подбирает зум под bounding box дерева — на маленьком/компактном дереве
          // он лупит почти в упор (maxZoom по умолчанию не ограничен снизу разумно). Кэпим ЗАХОД
          // на разумном максимуме (1x), чтобы все связи были видно сразу; ручной зум колесом/пинчем
          // (maxZoom=2.6 ниже) не трогаем — им можно приблизить, если захочется.
          fitView fitViewOptions={{ padding: 0.35, maxZoom: 1 }} minZoom={0.3} maxZoom={2.6}
          proOptions={{ hideAttribution: true }} connectionLineStyle={{ stroke: AMBER, strokeWidth: 1.5 }}
        >
          <Background variant={BackgroundVariant.Lines} gap={44} color="rgba(235,211,162,0.05)" />
          <Controls showInteractive={false} />
          <Panel position="top-center"><span style={{ fontSize: 11, color: "#A89F90" }}>{dt("Поднеси узел к узлу — связать · рамкой выдели группу · два пальца — панорама", "Bring a node close to link · drag a box to select · two fingers to pan")}</span></Panel>
        </ReactFlow>
      </div>

      {openTask && <TaskModal task={openTask} open onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void load(); }} />}
      {creating && <TaskModal open prefill={{}} projectId={project.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
    </div>
  );
}
