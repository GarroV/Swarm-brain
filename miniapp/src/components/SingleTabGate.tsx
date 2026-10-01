"use client";
import { useLayoutEffect, useState } from "react";
import { registerInstance, tryHandoff } from "@/lib/single-tab";

// Гейт дедупликации вкладок. Оборачивает приложение в layout.
// - Без deep-link (`?meeting=`) — сразу рендерит детей и регистрирует инстанс как
//   возможного лидера (+ launchQueue для установленного PWA).
// - С deep-link — пытается отдать встречу уже открытой вкладке (tryHandoff). Если
//   удалось — закрывает себя; иначе становится лидером и рендерит детей.
//
// Первый рендер ОБЯЗАН совпадать с серверным (статический экспорт рендерит приложение, адреса
// не знает): раньше при `?meeting=` клиент сразу рисовал заставку, React ловил расхождение
// гидратации (#418), пересоздавал дерево и снимал с <html> класс `dark`, выставленный
// THEME_SCRIPT, — вход по ссылке из уведомления открывался в светлой теме (#640). Теперь дети
// рендерятся всегда, а заставка встаёт ПОВЕРХ в layout-эффекте — после гидратации, до отрисовки.

function readMeetingId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("meeting");
}

type GateState = "checking" | "open" | "handed-off";

export function SingleTabGate({ children }: { children: React.ReactNode }) {
  // "checking" только когда есть deep-link и идёт хэндофф; выставляется после гидратации.
  const [state, setState] = useState<GateState>("open");

  useLayoutEffect(() => {
    let cancelled = false;
    const meetingId = readMeetingId();
    if (!meetingId) {
      registerInstance();
      return;
    }
    setState("checking");
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

  return (
    <>
      {children}
      {state === "handed-off" && <Splash text="Открыто в другой вкладке — её можно закрыть." />}
      {state === "checking" && <Splash text="Открываю встречу…" />}
    </>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-6 text-center text-sm text-foreground/60">
      {text}
    </div>
  );
}
