"use client";
import { useEffect, useState } from "react";
import { registerInstance, tryHandoff } from "@/lib/single-tab";

// Гейт дедупликации вкладок. Оборачивает приложение в layout.
// - Без deep-link (`?meeting=`) — сразу рендерит детей и регистрирует инстанс как
//   возможного лидера (+ launchQueue для установленного PWA).
// - С deep-link — пытается отдать встречу уже открытой вкладке (tryHandoff). Если
//   удалось — закрывает себя; иначе становится лидером и рендерит детей.

function readMeetingId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("meeting");
}

type GateState = "checking" | "open" | "handed-off";

export function SingleTabGate({ children }: { children: React.ReactNode }) {
  // "checking" только когда есть deep-link и идёт хэндофф; иначе сразу "open".
  const [state, setState] = useState<GateState>(() => (readMeetingId() ? "checking" : "open"));

  useEffect(() => {
    let cancelled = false;
    const meetingId = readMeetingId();
    if (!meetingId) {
      registerInstance();
      return;
    }
    tryHandoff(meetingId).then((handed) => {
      if (cancelled) return;
      if (handed) {
        setState("handed-off");
        try { window.close(); } catch { /* окно не закрылось — покажем заглушку */ }
        return;
      }
      registerInstance();
      setState("open");
    });
    return () => { cancelled = true; };
  }, []);

  if (state === "handed-off") return <Splash text="Открыто в другой вкладке — её можно закрыть." />;
  if (state === "checking") return <Splash text="Открываю встречу…" />;
  return <>{children}</>;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background px-6 text-center text-sm text-foreground/60">
      {text}
    </div>
  );
}
