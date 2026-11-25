"use client";
import { useRef, useState } from "react";

/** Keep the review item open on failed persistence; one outstanding mutation per modal. */
export function useGranolaSave() {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const pending = useRef(false);

  const save = async (operation: () => Promise<unknown>, onSaved: () => void) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await operation();
      onSaved();
    } catch {
      setSaveError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return { saving, saveError, save };
}
