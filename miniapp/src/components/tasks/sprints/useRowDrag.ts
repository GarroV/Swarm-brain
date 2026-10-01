"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DraggedTask,
  type DropTarget,
  hoverMode,
  type HoverMode,
  LONG_PRESS_MS,
  SUBTASK_HOLD_MS,
} from "@/lib/sprintGrouping";

// Перетаскивание строк списка спринта (решение 01.10.2026): задачу бросают на задачу — группа,
// подержал над задачей — подзадача, на заголовок — перенос. Решение «что сделать» — в
// lib/sprintGrouping.ts; здесь только жест.
//
// Почему Pointer Events, а не нативный HTML5-DnD, как у канбана. На таче HTML5-DnD нет вовсе, а
// владелец: «на свайпах еще как удобно перетаскивать». Один код на мышь и палец: мышь начинает
// тащить, сдвинувшись на несколько пикселей; палец — долгим нажатием (короткий свайп остаётся
// прокруткой списка). Цель ищется `elementFromPoint` по data-атрибутам строк и заголовков.

/** Что знает список про строку: из этого собираются и тащимая задача, и цель. */
export type RowInfo = DraggedTask & { title: string; isSubtask: boolean };

export type DragView = {
  dragged: RowInfo;
  x: number;
  y: number;
  target: DropTarget | null;
  /** Ключ цели: `task:<id>` или `header:<id|none>` — для подсветки. */
  targetKey: string | null;
  mode: HoverMode;
};

const MOUSE_SLOP = 5; // мышь: сдвиг до начала перетаскивания, иначе это клик
const TOUCH_SLOP = 8; // палец: сдвиг до долгого нажатия — это прокрутка, не перетаскивание
const EDGE = 56; // автопрокрутка у краёв
const EDGE_SPEED = 14;
export const NONE_HEADER = "__none__";

type Gesture = {
  pointerId: number;
  touch: boolean;
  startX: number;
  startY: number;
  row: RowInfo;
  el: HTMLElement;
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur; cur = cur.parentElement) {
    const oy = getComputedStyle(cur).overflowY;
    if (
      (oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight
    ) return cur;
  }
  return null;
}

function hitTest(
  x: number,
  y: number,
  rows: Map<string, RowInfo>,
): { target: DropTarget; key: string } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const hit = el?.closest<HTMLElement>("[data-sg-task],[data-sg-header]");
  if (!hit) return null;
  const taskId = hit.dataset.sgTask;
  if (taskId) {
    const r = rows.get(taskId);
    if (!r) return null;
    return {
      key: `task:${taskId}`,
      target: {
        kind: "task",
        taskId,
        projectId: r.projectId,
        isSubtask: r.isSubtask,
      },
    };
  }
  const h = hit.dataset.sgHeader!;
  return {
    key: `header:${h}`,
    target: { kind: "header", projectId: h === NONE_HEADER ? null : h },
  };
}

export function useRowDrag(opts: {
  enabled: boolean;
  rows: Map<string, RowInfo>;
  onDrop: (dragged: RowInfo, target: DropTarget, mode: HoverMode) => void;
}) {
  const [view, setView] = useState<DragView | null>(null);
  const g = useRef<Gesture | null>(null);
  const viewRef = useRef<DragView | null>(null);
  const enteredAt = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef<number | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const live = useRef(opts);
  live.current = opts;

  const publish = useCallback((next: DragView | null) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const retarget = useCallback((x: number, y: number) => {
    const cur = viewRef.current;
    if (!cur) return;
    const hit = hitTest(x, y, live.current.rows);
    const key = hit?.key ?? null;
    if (key !== cur.targetKey) {
      // Новая цель — таймер задержки заново: «увёл курсор — режим снова группа».
      if (holdTimer.current) clearTimeout(holdTimer.current);
      enteredAt.current = hit?.target.kind === "task" ? Date.now() : null;
      if (enteredAt.current !== null) {
        holdTimer.current = setTimeout(() => {
          const v = viewRef.current;
          if (v && v.targetKey === key) {
            publish({ ...v, mode: hoverMode(enteredAt.current, Date.now()) });
          }
        }, SUBTASK_HOLD_MS);
      }
    }
    publish({
      ...cur,
      x,
      y,
      target: hit?.target ?? null,
      targetKey: key,
      mode: hoverMode(enteredAt.current, Date.now()),
    });
  }, [publish]);

  const autoscroll = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const el = scroller.current;
    const top = el ? el.getBoundingClientRect().top : 0;
    const bottom = el ? el.getBoundingClientRect().bottom : globalThis.innerHeight;
    const dy = v.y < top + EDGE
      ? -EDGE_SPEED
      : v.y > bottom - EDGE
      ? EDGE_SPEED
      : 0;
    if (dy !== 0) {
      if (el) el.scrollTop += dy;
      else globalThis.scrollBy(0, dy);
      retarget(v.x, v.y);
    }
    raf.current = requestAnimationFrame(autoscroll);
  }, [retarget]);

  // Палец после долгого нажатия не должен прокручивать список: touchmove гасится, пока строка
  // поднята. Слушатель неспассивный и стоит с начала касания — иначе браузер успеет решить, что
  // это прокрутка, и отменит жест (pointercancel).
  const blockTouch = useCallback((e: TouchEvent) => {
    if (g.current?.started) e.preventDefault();
  }, []);
  const blockMenu = useCallback((e: Event) => {
    if (g.current) e.preventDefault();
  }, []);

  const finish = useCallback((drop: boolean) => {
    const gesture = g.current;
    const v = viewRef.current;
    if (gesture?.timer) clearTimeout(gesture.timer);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    enteredAt.current = null;
    g.current = null;
    document.removeEventListener("touchmove", blockTouch);
    document.removeEventListener("contextmenu", blockMenu);
    document.body.style.userSelect = "";
    if (gesture?.started) {
      // Клик, который браузер пришлёт после отпускания, открыл бы карточку задачи.
      const swallow = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      globalThis.addEventListener("click", swallow, { capture: true });
      setTimeout(
        () => globalThis.removeEventListener("click", swallow, { capture: true }),
        0,
      );
    }
    publish(null);
    if (drop && gesture?.started && v?.target) {
      live.current.onDrop(gesture.row, v.target, v.mode);
    }
  }, [blockMenu, blockTouch, publish]);

  const begin = useCallback((x: number, y: number) => {
    const gesture = g.current;
    if (!gesture || gesture.started) return;
    gesture.started = true;
    document.body.style.userSelect = "none";
    if (gesture.touch) {
      try {
        navigator.vibrate?.(15);
      } catch { /* нет вибрации — не беда */ }
    }
    scroller.current = scrollParent(gesture.el);
    publish({
      dragged: gesture.row,
      x,
      y,
      target: null,
      targetKey: null,
      mode: "group",
    });
    retarget(x, y);
    raf.current = requestAnimationFrame(autoscroll);
  }, [autoscroll, publish, retarget]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const gesture = g.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const dist = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
      if (!gesture.started) {
        if (gesture.touch) {
          if (dist > TOUCH_SLOP) finish(false); // это прокрутка
        } else if (dist > MOUSE_SLOP) begin(e.clientX, e.clientY);
        return;
      }
      retarget(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (g.current && e.pointerId === g.current.pointerId) finish(true);
    };
    const cancel = (e: PointerEvent) => {
      if (g.current && e.pointerId === g.current.pointerId) finish(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && g.current?.started) finish(false);
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
    globalThis.addEventListener("pointercancel", cancel);
    globalThis.addEventListener("keydown", key);
    return () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
      globalThis.removeEventListener("pointercancel", cancel);
      globalThis.removeEventListener("keydown", key);
    };
  }, [begin, finish, retarget]);

  useEffect(() => () => finish(false), [finish]);

  /** Пропсы строки: она и ручка, и цель. Кнопки и поля внутри строки жест не начинают. */
  const rowProps = useCallback((taskId: string) => ({
    "data-sg-task": taskId,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const o = live.current;
      if (!o.enabled || g.current || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button,input,textarea,select,a")) {
        return;
      }
      const row = o.rows.get(taskId);
      if (!row) return;
      const touch = e.pointerType !== "mouse";
      g.current = {
        pointerId: e.pointerId,
        touch,
        startX: e.clientX,
        startY: e.clientY,
        row,
        el: e.currentTarget,
        started: false,
        timer: null,
      };
      document.addEventListener("touchmove", blockTouch, { passive: false });
      document.addEventListener("contextmenu", blockMenu);
      if (touch) {
        const { clientX, clientY } = e;
        g.current.timer = setTimeout(() => begin(clientX, clientY), LONG_PRESS_MS);
      }
    },
  }), [begin, blockMenu, blockTouch]);

  const headerProps = useCallback((projectId: string | null) => ({
    "data-sg-header": projectId ?? NONE_HEADER,
  }), []);

  return { view, rowProps, headerProps };
}
