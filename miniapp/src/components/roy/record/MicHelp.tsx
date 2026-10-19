"use client";
// Отказ в микрофоне: что случилось и конкретные шаги для браузера человека. Когда доступ разрешили
// (Permissions API шлёт change), подсказываем нажать «Попробовать снова» — сами запись не стартуем:
// getUserMedia и AudioContext обязаны стартовать из нажатия.
import { useEffect, useMemo, useState } from "react";
import { detectMicEnv, micSteps, type MicStep, type RecorderErrorCode } from "@/lib/webRecorder";
import { useDt } from "../nav";

type MicDenialCode = Extract<RecorderErrorCode, "permission-denied" | "mic-blocked-site" | "mic-blocked-os">;

/** true, как только состояние разрешения микрофона стало «granted» (пока `active`). */
export function useMicGranted(active: boolean): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!active) { setGranted(false); return; }
    let status: PermissionStatus | null = null;
    let alive = true;
    const sync = () => { if (alive && status) setGranted(status.state === "granted"); };
    void navigator.permissions?.query({ name: "microphone" as PermissionName })
      .then((st) => { status = st; st.addEventListener("change", sync); })
      .catch(() => {}); // нет Permissions API — просто без подсказки
    return () => { alive = false; status?.removeEventListener("change", sync); };
  }, [active]);
  return granted;
}

export function MicHelp({ code }: { code: MicDenialCode }) {
  const dt = useDt();
  const granted = useMicGranted(true);
  const steps = useMemo<MicStep[]>(() => micSteps(code, detectMicEnv(navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } })), [code]);
  return (
    <div className="flex flex-col gap-2">
      <ol className="list-decimal space-y-1 pl-5 text-ink-soft" style={{ fontSize: 13, lineHeight: 1.45 }}>
        {steps.map((s) => <li key={s.ru}>{dt(s.ru, s.en)}</li>)}
      </ol>
      {granted && (
        <p role="status" className="font-semibold" style={{ fontSize: 13, color: "var(--status-done)" }}>
          {dt("Доступ разрешён — нажмите «Попробовать снова»", "Access allowed — tap “Try again”")}
        </p>
      )}
    </div>
  );
}
