"use client";
import { useCallback } from "react";
import { useLang } from "@/components/roy/nav";
import { type SpacesKey, spacesText, type Vars } from "@/lib/spacesDict";

export type { SpacesKey };

/** Функция `t(ключ, подстановки)` для компонента; ссылка стабильна, пока не сменился язык. */
export function useSpacesText(): (key: SpacesKey, vars?: Vars) => string {
  const lang = useLang();
  return useCallback((key: SpacesKey, vars?: Vars) => spacesText(lang, key, vars), [lang]);
}
