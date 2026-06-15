"use client";
import { createContext, useContext } from "react";
import type { Me } from "@/types";

// Навигация в стиле прототипа: 4 корневых таба + push-стек детальных/создающих экранов.
// Вынесено в отдельный модуль, чтобы RoyApp и экраны не образовывали циклический импорт.

export type RoyTab = "search" | "task" | "book" | "cal";

export type RoyRoute =
  | { view: "answer"; params: { query: string } }
  | { view: "record"; params: { id: string } }
  | { view: "taskDetail"; params: { id: string } }
  | { view: "newTask"; params?: { id?: string } }
  | { view: "meetingReview"; params: { id: string } }
  | { view: "settings" }
  | { view: "team" }
  | { view: "admin" }
  | { view: "more" };

export type RoyNav = {
  me: Me | null;
  tab: RoyTab;
  setTab: (t: RoyTab) => void;
  push: (r: RoyRoute) => void;
  pop: () => void;
  toast: (msg: string) => void;
};

export const RoyNavContext = createContext<RoyNav | null>(null);

export function useRoyNav(): RoyNav {
  const ctx = useContext(RoyNavContext);
  if (!ctx) throw new Error("useRoyNav must be used within RoyApp");
  return ctx;
}
