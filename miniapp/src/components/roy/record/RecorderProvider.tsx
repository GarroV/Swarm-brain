"use client";
// Запись встречи из браузера живёт на уровне приложения: движок держит этот провайдер (в RoyApp),
// поэтому смена экрана и вкладки запись не прерывает. Кнопки «Записать встречу» зовут start(),
// плавающий индикатор (RecordingPill) читает состояние.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsDemo, useRoyNav } from "../nav";
import {
  WebRecorder,
  findRecoverable,
  type RecorderErrorCode,
  type RecorderSnapshot,
  type RecoverableRecording,
} from "@/lib/webRecorder";

/**
 * Длина части для ручной проверки: `localStorage["swarm.recSegSeconds"] = "8"` работает только
 * в `next dev` (приложение стирает query из адреса, поэтому не параметр). В боевой сборке
 * NODE_ENV вшит как "production", и ветка выкидывается целиком.
 */
function devSegmentSeconds(): number | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    const v = Number(localStorage.getItem("swarm.recSegSeconds"));
    return v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

const IDLE_SNAPSHOT: RecorderSnapshot = {
  state: "idle", elapsedSec: 0, levels: [], segmentsUploaded: 0, segmentsPending: 0, segmentsFailed: 0,
  online: true, muted: false, wakeLock: false, interruptions: [], lastGapSec: null, error: null,
  summaryStatus: null, meetingId: null,
};

export interface RecorderApi {
  snap: RecorderSnapshot;
  /** Запись занята (идёт, прервана, досылается) — вторую не начать. */
  busy: boolean;
  /** Ошибка до начала записи, которую движок не видит (демо). */
  blocked: RecorderErrorCode | null;
  offer: RecoverableRecording | null;
  start(): void;
  stop(): void;
  continueRecording(): void;
  recover(): void;
  discardLocal(): void;
  /** Убрать виджет (готово / закрыть ошибку / «не сейчас»). Идущую запись не трогает. */
  dismiss(): void;
}

const RecorderContext = createContext<RecorderApi | null>(null);

export function useRecorder(): RecorderApi {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorder must be used within RecorderProvider");
  return ctx;
}

/** Незавершённую запись предлагаем один раз за сессию вкладки: «Не сейчас» не должно возвращаться. */
let offeredThisSession = false;

export function RecorderProvider({ children }: { children: ReactNode }) {
  const ownerId = useRoyNav().me?.telegram_id ?? null;
  const isDemo = useIsDemo();
  const [engine, setEngine] = useState<WebRecorder | null>(null);
  const [snap, setSnap] = useState<RecorderSnapshot>(IDLE_SNAPSHOT);
  const [offer, setOffer] = useState<RecoverableRecording | null>(null);
  const [blocked, setBlocked] = useState<RecorderErrorCode | null>(null);
  const engineRef = useRef<WebRecorder | null>(null);
  engineRef.current = engine;

  useEffect(() => {
    if (!engine) { setSnap(IDLE_SNAPSHOT); return; }
    engine.attach();
    const off = engine.subscribe(() => setSnap(engine.getSnapshot()));
    setSnap(engine.getSnapshot());
    return () => { off(); engine.dispose(); };
  }, [engine]);

  // Предложение дослать запись, оставшуюся после сбоя.
  useEffect(() => {
    if (offeredThisSession || ownerId === null || isDemo) return;
    let alive = true;
    void findRecoverable(ownerId).then((found) => {
      if (!alive || !found) return;
      offeredThisSession = true;
      setOffer(found);
    });
    return () => { alive = false; };
  }, [ownerId, isDemo]);

  const busy = snap.state === "starting" || snap.state === "recording" || snap.state === "interrupted" || snap.state === "stopping";

  const api = useMemo<RecorderApi>(() => ({
    snap,
    busy,
    blocked,
    offer,
    // Вызывается синхронно из нажатия: движок будит AudioContext в том же обработчике.
    start: () => {
      if (isDemo) { setBlocked("demo"); return; }
      const cur = engineRef.current;
      if (cur && (cur.getSnapshot().state === "starting" || cur.getSnapshot().state === "recording" || cur.getSnapshot().state === "interrupted" || cur.getSnapshot().state === "stopping")) return;
      setBlocked(null);
      setOffer(null);
      const next = new WebRecorder({ segmentSeconds: devSegmentSeconds(), ownerId });
      setEngine(next);
      next.start();
    },
    stop: () => { void engineRef.current?.stop(); },
    continueRecording: () => engineRef.current?.continueRecording(),
    recover: () => {
      if (!offer) return;
      const next = new WebRecorder({ ownerId });
      setEngine(next);
      setOffer(null);
      void next.recover(offer);
    },
    discardLocal: () => { void engineRef.current?.discardLocal(); },
    dismiss: () => {
      setBlocked(null);
      setOffer(null);
      const cur = engineRef.current;
      if (cur && cur.getSnapshot().state !== "recording" && cur.getSnapshot().state !== "interrupted") setEngine(null);
    },
  }), [snap, busy, blocked, offer, isDemo, ownerId]);

  return <RecorderContext.Provider value={api}>{children}</RecorderContext.Provider>;
}
