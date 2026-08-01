"use client";
import { useEffect, useRef } from "react";
import type { Task } from "@/types";

export type ProjectHub = { id: string; name: string; color: string | null; emoji: string | null };

type Node = { id: string; x: number; y: number; r: number; task: Task | null; hub: boolean };

type Params = {
  hub: ProjectHub;
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onToggleLink: (taskId: string, linked: boolean) => void;
};

// Детерминированный псевдослучай по числу (как nrand в system-map.html) — стабильная раскладка.
function nrand(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function useProjectCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  params: Params,
) {
  // Держим свежие params в ref, чтобы не пересоздавать rAF-цикл на каждый апдейт.
  const p = useRef(params);
  p.current = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    let W = 0, H = 0;
    const cam = { tx: 0, ty: 0, s: 1 };
    let nodes: Node[] = [];
    let dragNode: Node | null = null;
    let panning = false;
    let moved = false;
    let downX = 0, downY = 0, lastX = 0, lastY = 0;
    let raf = 0;

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.tx = W / 2; cam.ty = H / 2; // центр = хаб в мировых (0,0)
    }

    // Раскладка: хаб в (0,0); связанные — внутреннее кольцо, плавающие — внешнее.
    function layout() {
      const hub: Node = { id: p.current.hub.id, x: 0, y: 0, r: 46, task: null, hub: true };
      const linked = p.current.tasks.filter((t) => t.project_linked);
      const floating = p.current.tasks.filter((t) => !t.project_linked);
      const ring = (arr: Task[], radius: number): Node[] =>
        arr.map((t, i) => {
          const a = (i / Math.max(1, arr.length)) * Math.PI * 2 + nrand(i + radius) * 0.4;
          const jr = radius + nrand(i * 3 + radius) * 40;
          return { id: t.id, x: Math.cos(a) * jr, y: Math.sin(a) * jr, r: 22, task: t, hub: false };
        });
      nodes = [hub, ...ring(linked, 150), ...ring(floating, 320)];
    }

    function pick(sx: number, sy: number): Node | null {
      const wx = (sx - cam.tx) / cam.s, wy = (sy - cam.ty) / cam.s;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= (n.r + 6) ** 2) return n;
      }
      return null;
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      ctx!.save();
      ctx!.translate(cam.tx, cam.ty);
      ctx!.scale(cam.s, cam.s);
      const hub = nodes.find((n) => n.hub)!;
      // Линии хаб→связанные.
      nodes.forEach((n) => {
        if (n.hub || !n.task?.project_linked) return;
        ctx!.strokeStyle = "rgba(91,141,239,0.55)"; ctx!.lineWidth = 1.5;
        ctx!.beginPath(); ctx!.moveTo(hub.x, hub.y); ctx!.lineTo(n.x, n.y); ctx!.stroke();
      });
      // Узлы.
      nodes.forEach((n) => {
        ctx!.beginPath(); ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = n.hub ? (p.current.hub.color ?? "#5b8def")
          : n.task?.project_linked ? "#2a2a35" : "#1c1c24";
        ctx!.fill();
        if (!n.hub) { ctx!.strokeStyle = n.task?.project_linked ? "#5b8def" : "#3a3a44"; ctx!.lineWidth = 1; ctx!.stroke(); }
        const label = n.hub ? p.current.hub.name : (n.task?.title ?? "");
        ctx!.fillStyle = n.hub ? "#fff" : "#cfcfd6";
        ctx!.font = n.hub ? "600 12px sans-serif" : "11px sans-serif";
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillText(label.slice(0, n.hub ? 12 : 14), n.x, n.y);
      });
      ctx!.restore();
    }

    function rel(e: PointerEvent) {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function onDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const pt = rel(e); downX = pt.x; downY = pt.y; lastX = pt.x; lastY = pt.y; moved = false;
      const n = pick(pt.x, pt.y);
      if (n && !n.hub) dragNode = n; else panning = true;
    }
    function onMove(e: PointerEvent) {
      const pt = rel(e);
      if (Math.abs(pt.x - downX) + Math.abs(pt.y - downY) > 4) moved = true;
      if (dragNode) {
        dragNode.x += (pt.x - lastX) / cam.s; dragNode.y += (pt.y - lastY) / cam.s;
      } else if (panning) {
        cam.tx += pt.x - lastX; cam.ty += pt.y - lastY;
      }
      lastX = pt.x; lastY = pt.y;
    }
    function onUp(e: PointerEvent) {
      const pt = rel(e);
      if (dragNode && !moved) {
        p.current.onOpenTask(dragNode.id); // клик без драга → открыть задачу
      } else if (dragNode && moved && dragNode.task) {
        // drag-to-connect: расстояние узла до хаба в мировых координатах.
        const hub = nodes.find((n) => n.hub)!;
        const dist = Math.hypot(dragNode.x - hub.x, dragNode.y - hub.y);
        const nowLinked = dist < 110;               // втащили в зону хаба → связать
        if (nowLinked !== dragNode.task.project_linked) {
          p.current.onToggleLink(dragNode.task.id, nowLinked);
        }
        // Раскладку НЕ пересчитываем здесь синхронно (убран вызов layout()).
        // onToggleLink делает оптимистичный setState в вызывающем компоненте →
        // tasks меняется → deps эффекта меняются → эффект пересоздаётся → layout()
        // выше (в setup) вызовется уже с НОВЫМ project_linked. Синхронный layout()
        // тут читал бы старый project_linked из p.current (ref ещё не обновлён к
        // моменту этого колбэка) и на 1 кадр откатывал бы узел на старое кольцо —
        // визуальный flicker перед корректирующим ре-рендером. Побочный эффект:
        // если статус НЕ поменялся (drop без пересечения зоны хаба), узел остаётся
        // там, где его бросили, до следующего ре-рендера/пересоздания эффекта —
        // приемлемо (per task-9 brief).
      }
      dragNode = null; panning = false;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = canvas!.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const wx = (px - cam.tx) / cam.s, wy = (py - cam.ty) / cam.s;
      cam.s = Math.max(0.4, Math.min(2.5, cam.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      cam.tx = px - wx * cam.s; cam.ty = py - wy * cam.s;
    }

    resize();
    layout();
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement!);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // Пересоздаём цикл только при смене набора задач/хаба (по id и связям), не на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canvasRef,
    params.hub.id,
    params.tasks.map((t) => `${t.id}:${t.project_linked}`).join(","),
  ]);
}
