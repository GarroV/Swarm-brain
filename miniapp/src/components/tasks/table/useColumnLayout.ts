"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampColumn,
  columnLayoutKey,
  defaultLayout,
  moveColumn,
  resolveColumnLayout,
  type ColumnLayout,
  type MovableColumn,
  type ResizableColumn,
} from "@/lib/taskColumns";

// Раскладка колонок таблицы задач (ширины + порядок): читается из localStorage ПОСЛЕ монтирования
// (статический экспорт — на сервере хранилища нет, иначе разошлась бы гидратация) и пишется, когда
// человек отпустил ручку или колонку. Хранилище может отказать (приватное окно, запрет сайта) —
// тогда живёт дефолт, таблица работает как раньше, просто без памяти.
function load(userId: number | null | undefined): ColumnLayout {
  try {
    const raw = localStorage.getItem(columnLayoutKey(userId));
    return resolveColumnLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLayout();
  }
}

function save(userId: number | null | undefined, layout: ColumnLayout) {
  try {
    localStorage.setItem(columnLayoutKey(userId), JSON.stringify(layout));
  } catch {
    /* без хранилища раскладка живёт до перезагрузки — это не ошибка для человека */
  }
}

export function useColumnLayout(userId: number | null | undefined) {
  const [layout, setLayout] = useState<ColumnLayout>(defaultLayout);
  const latest = useRef(layout);

  const apply = useCallback((next: ColumnLayout, persist: boolean) => {
    latest.current = next;
    setLayout(next);
    if (persist) save(userId, next);
  }, [userId]);

  useEffect(() => {
    const loaded = load(userId);
    latest.current = loaded;
    setLayout(loaded);
  }, [userId]);

  const setWidth = useCallback((col: ResizableColumn, px: number, persist = false) => {
    const cur = latest.current;
    apply({ ...cur, widths: { ...cur.widths, [col]: clampColumn(col, px) } }, persist);
  }, [apply]);

  const resetWidth = useCallback((col: ResizableColumn) => {
    setWidth(col, defaultLayout().widths[col], true);
  }, [setWidth]);

  const move = useCallback((col: MovableColumn, target: MovableColumn) => {
    const cur = latest.current;
    apply({ ...cur, order: moveColumn(cur.order, col, target) }, true);
  }, [apply]);

  const commit = useCallback(() => save(userId, latest.current), [userId]);
  const resetAll = useCallback(() => apply(defaultLayout(), true), [apply]);

  return { layout, setWidth, resetWidth, move, commit, resetAll };
}
