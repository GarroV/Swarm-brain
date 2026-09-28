"use client";
import { useEffect, useState } from "react";
import {
  BACKDROP_CHANGE_EVENT,
  BACKDROP_STORAGE_KEY,
  type BackdropId,
  DEFAULT_BACKDROP,
  readCachedBackdrop,
  resolveBackdrop,
} from "./backdrop";

/** Текущий задник вкладки; следит за выбором здесь и в соседних вкладках. */
export function useBackdrop(): BackdropId {
  const [id, setId] = useState<BackdropId>(DEFAULT_BACKDROP);
  useEffect(() => {
    setId(readCachedBackdrop());
    const onChange = (e: Event) => setId((e as CustomEvent<BackdropId>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === BACKDROP_STORAGE_KEY) {
        const next = resolveBackdrop(e.newValue);
        document.documentElement.dataset.backdrop = next;
        setId(next);
      }
    };
    window.addEventListener(BACKDROP_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage); // смена в соседней вкладке
    return () => {
      window.removeEventListener(BACKDROP_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return id;
}
