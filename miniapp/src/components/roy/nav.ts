"use client";
import { createContext, useContext } from "react";
import type { Me, Task } from "@/types";

// Навигация в стиле прототипа: 4 корневых таба + push-стек детальных/создающих экранов.
// Вынесено в отдельный модуль, чтобы RoyApp и экраны не образовывали циклический импорт.

export type RoyTab = "search" | "task" | "book" | "cal";

export type RoyRoute =
  | { view: "answer"; params: { query: string } }
  | { view: "record"; params: { id: string } }
  | { view: "taskDetail"; params: { id: string } }
  | { view: "newTask"; params?: { id?: string } }
  | { view: "newEntry" }
  | { view: "meetingDetail"; params: { id: string } }
  | { view: "meetingReview"; params: { id: string } }
  | { view: "settings" }
  | { view: "team" }
  | { view: "admin" }
  | { view: "more" }
  | { view: "map" }
  | { view: "meetAdmin" };

export type RoyNav = {
  me: Me | null;
  tab: RoyTab;
  setTab: (t: RoyTab) => void;
  push: (r: RoyRoute) => void;
  pop: () => void;
  toast: (msg: string) => void;
  // Открыть задачу в едином контекстном окне-редакторе (модал, рендерится в корне RoyApp).
  // Любой клик по задаче (главная/мобайл/встречи/доска) ведёт сюда — не на отдельный экран.
  openTask: (task: Task) => void;
  // Открыть ответ: на десктопе — контекстное окно (модал поверх дашборда), на мобайле —
  // полноэкранный push (AnswerScreen). Все поиски/«углубиться» ведут сюда.
  openAnswer: (query: string) => void;
  // Счётчик ревизии задач: модал бампает его при сохранении/удалении → списки задач,
  // включившие его в deps, перезапрашиваются (общий рефреш без per-caller колбэков).
  tasksVersion: number;
  // Бампнуть tasksVersion вручную (например, после inline-чекбокса на дашборде).
  bumpTasks: () => void;
};

export const RoyNavContext = createContext<RoyNav | null>(null);

export function useRoyNav(): RoyNav {
  const ctx = useContext(RoyNavContext);
  if (!ctx) throw new Error("useRoyNav must be used within RoyApp");
  return ctx;
}
