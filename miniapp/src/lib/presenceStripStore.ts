// Опрос полоски присутствия: один на вкладку, как бы много полосок (по одной у каждого
// колокольчика) ни было смонтировано. Первый подписчик запускает опрос, последний гасит.
// Опрос идёт раз в STRIP_POLL_MS, пока вкладка видна; возврат на вкладку — опрос сразу;
// пока скрыта — не опрашиваем (фоновые вкладки не держат трафик).
import { fetchPresenceStrip } from "@/lib/api";
import { parseStrip, STRIP_POLL_MS, stripSignature, type StripPerson } from "@/lib/presenceStrip";

const EMPTY: readonly StripPerson[] = [];

let snapshot: readonly StripPerson[] = EMPTY;
let signature = "";
let timer: number | null = null;
let inFlight = false;
let stopped = false;
let warned = false;
const listeners = new Set<() => void>();

async function poll(): Promise<void> {
  if (inFlight || stopped || document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    const parsed = parseStrip(await fetchPresenceStrip());
    if (!parsed) throw new Error("unexpected response");
    const sig = stripSignature(parsed);
    if (sig !== signature) {
      signature = sig;
      snapshot = parsed.people;
      listeners.forEach((l) => l());
    }
  } catch (e) {
    // Не вошёл — спрашивать незачем до перезагрузки; прочее — один warn, шапка не падает.
    if (e instanceof Error && /HTTP 40[13]/.test(e.message)) stopped = true;
    if (!warned) {
      warned = true;
      console.warn("[presence] полоска не обновилась", e);
    }
  } finally {
    inFlight = false;
  }
}

const onVisibility = () => {
  if (document.visibilityState === "visible") void poll();
};

function start(): void {
  void poll();
  timer = window.setInterval(() => void poll(), STRIP_POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stop(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

export function subscribeStrip(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export const getStripSnapshot = (): readonly StripPerson[] => snapshot;
export const getStripServerSnapshot = (): readonly StripPerson[] => EMPTY;
