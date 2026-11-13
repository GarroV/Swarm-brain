"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SCHEME, readCachedScheme, SCHEME_CHANGE_EVENT, type SchemeId } from "./scheme";
import { readTheme, THEME_CHANGE_EVENT, type ThemeId } from "./theme";

/** Текущая схема вкладки; следит за выбором здесь (событие applyScheme). */
export function useScheme(): SchemeId {
  const [id, setId] = useState<SchemeId>(DEFAULT_SCHEME);
  useEffect(() => {
    setId(readCachedScheme());
    const onChange = (e: Event) => setId((e as CustomEvent<SchemeId>).detail);
    window.addEventListener(SCHEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, onChange);
  }, []);
  return id;
}

/** Выбранный режим (светлая / тёмная / как в системе); следит за рейкой и за меню оформления. */
export function useThemeMode(): ThemeId {
  const [theme, setTheme] = useState<ThemeId>("system");
  useEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);
  return theme;
}
