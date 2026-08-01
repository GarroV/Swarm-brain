"use client";
import { useMemo } from "react";
import { ReactFlow, Background, BackgroundVariant, Controls, type Node, type Edge, Handle, Position, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ── warm tech-HUD узел (спайк) ──
type NodeData = { label: string; kind: "root" | "task"; state?: "done" };
function HudNode({ data }: NodeProps) {
  const d = data as NodeData;
  const root = d.kind === "root";
  const done = d.state === "done";
  const accent = done ? "#2E9E6B" : "#D98A2B";
  const accentHi = done ? "#52B98C" : "#F0B45F";
  return (
    <div
      style={{
        position: "relative",
        minWidth: root ? 150 : 130,
        padding: root ? "12px 16px" : "9px 13px",
        borderRadius: 12,
        background: "#221a10",
        border: `${root ? 2.2 : 1.6}px solid ${accent}`,
        color: "#F2EDE3",
        font: `${root ? 800 : 600} ${root ? 15 : 12.5}px -apple-system,system-ui,sans-serif`,
        boxShadow: `0 0 18px ${accentHi}55, inset 0 0 14px ${accent}22`,
        display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 3, background: accentHi, boxShadow: `0 0 8px ${accentHi}` }} />
      {d.label}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { hud: HudNode };

// Спайк-данные (хардкод) — проверяем, что RF рендерит под Next 16 / React 19.
const SPIKE_NODES: Node[] = [
  { id: "root", type: "hud", position: { x: 280, y: 40 }, data: { label: "Swarm Brain", kind: "root" } },
  { id: "t1", type: "hud", position: { x: 120, y: 200 }, data: { label: "Поиск по базе", kind: "task" } },
  { id: "t2", type: "hud", position: { x: 440, y: 200 }, data: { label: "Дайджест", kind: "task", state: "done" } },
  { id: "s1", type: "hud", position: { x: 120, y: 340 }, data: { label: "Страновой фильтр", kind: "task", state: "done" } },
];
const SPIKE_EDGES: Edge[] = [
  { id: "e-root-t1", source: "root", target: "t1", animated: true, style: { stroke: "#D98A2B" } },
  { id: "e-root-t2", source: "root", target: "t2", animated: true, style: { stroke: "#2E9E6B" } },
  { id: "e-t1-s1", source: "t1", target: "s1", animated: true, style: { stroke: "#2E9E6B" } },
];

export function ProjectTree() {
  const nodes = useMemo(() => SPIKE_NODES, []);
  const edges = useMemo(() => SPIKE_EDGES, []);
  return (
    <div className="absolute inset-0" style={{ background: "#1A1714" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={2.4}
      >
        <Background variant={BackgroundVariant.Lines} gap={44} color="rgba(235,211,162,0.05)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
