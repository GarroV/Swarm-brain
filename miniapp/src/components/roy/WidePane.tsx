"use client";
import { createContext, useContext, useEffect } from "react";

// Потолок ширины рабочей области (1280px, RoyApp) нужен спокойным экранам, а доске спринтов он
// мешает: колонки спринтов должны занимать весь монитор (владелец 22.10.2026). Экран, которому
// нужна вся ширина, просит её хуком; уходя, возвращает потолок — остальные экраны как были.

export const WidePaneContext = createContext<(wide: boolean) => void>(() => {});

export function useWidePane(wide: boolean): void {
  const setWide = useContext(WidePaneContext);
  useEffect(() => {
    setWide(wide);
    return () => setWide(false);
  }, [wide, setWide]);
}
