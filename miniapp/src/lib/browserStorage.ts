/** UI state only: current names are written; legacy names remain read fallbacks. */
export const SWARM_STORAGE = {
  tab: { current: "swarm_tab", legacy: "roy_tab" },
  stack: { current: "swarm_stack", legacy: "roy_stack" },
  recent: { current: "swarm_recent_searches", legacy: "roy_recent_searches" },
} as const;

type Key = { readonly current: string; readonly legacy: string };
type Reader = { getItem(key: string): string | null };
type Writer = { setItem(key: string, value: string): void };
type Remover = { removeItem(key: string): void };

/** A present empty/invalid current value still belongs to the existing consumer parser. */
export function readStored(storage: Reader, key: Key): string | null {
  return storage.getItem(key.current) ?? storage.getItem(key.legacy);
}

export function writeStored(storage: Writer, key: Key, value: string): void {
  storage.setItem(key.current, value);
}

/** Explicit clear must not let a later reload resurrect the legacy value. */
export function clearStored(storage: Remover, key: Key): void {
  storage.removeItem(key.current);
  storage.removeItem(key.legacy);
}
