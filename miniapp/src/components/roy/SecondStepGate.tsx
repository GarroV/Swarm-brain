"use client";
// Экран-замок второго шага (решение владельца 26.10.2026, docs/decisions/2026-10-26-second-step-hard-gate.md):
// когда Touch ID обязателен, а в этой сессии не пройден, приложение не рисуется вовсе — только этот экран.
// Сервер в таком состоянии и так закрывает всё, кроме /me; раньше веб рисовал пустой интерфейс в вечной
// загрузке, и это выглядело как «все задачи пропали». Сам шаг — тот же runStep, что у PasskeyStep.
import { useEffect, useRef, useState } from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { Me } from "@/types";
import { logout } from "@/lib/api";
import { runStep } from "./PasskeyStep";

type Stage = "idle" | "busy" | "failed" | "unsupported";

export function SecondStepGate({ me }: { me: Me }) {
  const en = me.language === "en";
  const t = (ru: string, enText: string) => (en ? enText : ru);
  const [stage, setStage] = useState<Stage>("idle");
  const started = useRef(false);

  async function attempt(): Promise<void> {
    if (stage === "busy") return;
    setStage("busy");
    const r = await runStep();
    // Шаг пройден — кука сессии уже с отметкой; перезагрузка поднимает приложение с нуля.
    if (r.done) window.location.reload();
    else setStage("failed");
  }

  // Одна авто-попытка при открытии: в части браузеров окно без нажатия не откроется — тогда кнопка.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!browserSupportsWebAuthn()) { setStage("unsupported"); return; }
    void attempt();
    // attempt читает только состояние на момент вызова: зависимость зациклила бы эффект.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => { await logout(); window.location.href = "/login"; };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-[14px] border border-line bg-surface p-6">
        <h1 className="font-semibold text-ink" style={{ fontSize: 20 }}>{t("Подтвердите вход по Touch ID", "Confirm sign-in with Touch ID")}</h1>
        <p className="text-ink-soft" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {stage === "unsupported"
            ? t("Этот браузер не умеет Touch ID. Откройте SWARM в Chrome или Safari.", "This browser doesn't support Touch ID. Open SWARM in Chrome or Safari.")
            : t("Без второго шага SWARM не открывается. Приложите палец, когда браузер спросит.", "SWARM doesn't open without the second step. Use your fingerprint when the browser asks.")}
        </p>
        {stage === "failed" && (
          <p className="text-ink-mute" style={{ fontSize: 13 }}>{t("Не получилось. Нажмите ещё раз.", "That didn't work. Try again.")}</p>
        )}
        {stage !== "unsupported" && (
          <button type="button" onClick={() => void attempt()} disabled={stage === "busy"}
            className="rounded-[10px] bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60" style={{ fontSize: 14 }}>
            {stage === "busy" ? t("Ждём Touch ID…", "Waiting for Touch ID…") : t("Подтвердить по Touch ID", "Confirm with Touch ID")}
          </button>
        )}
        <button type="button" onClick={() => void signOut()} className="self-start text-ink-mute underline underline-offset-2" style={{ fontSize: 13 }}>
          {t("Выйти", "Sign out")}
        </button>
      </div>
    </div>
  );
}
