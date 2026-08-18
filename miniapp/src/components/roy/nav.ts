"use client";
import { createContext, useContext } from "react";
import type { Me, Task } from "@/types";
import type { Lens, SmartListId } from "@/lib/smartLists";

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
  | { view: "meetAdmin"; params?: { mode?: "review" | "all" } };

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
  // Открыть доску задач с заданной стартовой линзой/списком (вход из панелей дашборда
  // «Мои задачи»/«Задачи команды»). Применяется один раз при монтировании доски, затем
  // обычный setTab сбрасывает в null (дефолт). null → доска открывается с дефолтом (mine/today).
  taskView: { lens: Lens; list?: SmartListId } | null;
  openTasks: (lens: Lens, list?: SmartListId) => void;
};

// Источник /ask или /digest (AskSource) может быть встречей (entry_type="meeting") — тогда
// нужен полноценный MeetingDetail, а не общая RecordDetail. Раньше «Ответ»/дайджест всегда
// вели на record независимо от типа, хотя entry_type уже был в ответе — теряли транскрипт/
// reprocess/задачи для встреч (владелец: «почему у нас открывается разное окно…»). Общий
// хелпер — чтобы все потребители AskSource (AnswerScreen/AnswerModal/PersonalDigest) решали
// одинаково, не дублируя ветвление.
export function openSourceRoute(push: (r: RoyRoute) => void) {
  return (source: { id: string; entry_type: string }) => {
    push(source.entry_type === "meeting" ? { view: "meetingDetail", params: { id: source.id } } : { view: "record", params: { id: source.id } });
  };
}

export const RoyNavContext = createContext<RoyNav | null>(null);

export function useRoyNav(): RoyNav {
  const ctx = useContext(RoyNavContext);
  if (!ctx) throw new Error("useRoyNav must be used within RoyApp");
  return ctx;
}

// Демо-онли i18n: демо-сессия (me.is_demo) рендерится по-английски — витрина для
// портфолио garrov.github.io (встраивается в iframe на англоязычной странице).
// Лёгкий инлайновый вариант без словаря: dt("русский", "english"). Вне демо — RU.
export function useDt(): (ru: string, en: string) => string {
  const ctx = useContext(RoyNavContext);
  const demo = !!ctx?.me?.is_demo;
  return (ru, en) => (demo ? en : ru);
}
