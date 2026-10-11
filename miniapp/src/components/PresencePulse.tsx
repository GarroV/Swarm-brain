"use client";
// Пульс присутствия (#751): раз в 30 с, пока вкладка видна, сообщает серверу раздел и был ли
// ввод за минуту; смена раздела уходит сразу, скрытие и закрытие вкладки — как `away`.
// НИЧЕГО не рисует: данные видит только админ через GET /presence (решение владельца 09.10).
//
// Живёт в layout рядом с MaintenanceGate: раздел читается из адреса (RoyApp кладёт в него таб
// и экран, issue #31) и из сохранённого вида доски задач, поэтому каркас приложения не трогаем.
import { useEffect } from "react";
import { sendPresence, type PresencePing } from "@/lib/api";
import {
  isActive,
  presenceSection,
  PRESENCE_CHECK_MS,
  type PulseMemo,
  shouldPulse,
} from "@/lib/presence";

const INPUT_EVENTS = ["pointerdown", "keydown", "scroll", "mousemove", "touchstart"] as const;

function currentSection(): string | null {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem("roy_tasks_view");
  } catch { /* приватный режим — раздел без вкладки доски */ }
  return presenceSection(window.location.pathname, window.location.search, saved);
}

export function PresencePulse() {
  useEffect(() => {
    let lastInputAt = Date.now();
    let last: PulseMemo = null;
    let stopped = false;
    let warned = false;

    const send = (ping: PresencePing) => {
      if (stopped) return;
      sendPresence(ping)
        .then((status) => {
          // Не вошёл — пульсировать незачем; после входа страница перезагрузится.
          if (status === 401) stopped = true;
          else if (status >= 400 && !warned) {
            warned = true;
            console.warn(`[presence] пульс не принят: HTTP ${status}`);
          }
        })
        .catch((e: unknown) => {
          if (warned) return;
          warned = true;
          console.warn("[presence] пульс не ушёл", e);
        });
    };

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const section = currentSection();
      if (!section) return;
      const now = Date.now();
      const active = isActive(lastInputAt, now);
      if (!shouldPulse(last, section, active, now)) return;
      last = { section, active, at: now };
      send({ section, active });
    };

    const goAway = () => {
      const section = last?.section ?? currentSection();
      if (!section || last === null) return; // ещё ни разу не отмечался — уходить некому
      last = null; // вернётся — первый же пульс уйдёт сразу
      send({ section, active: false, away: true });
    };

    const onInput = () => {
      lastInputAt = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
      else goAway();
    };

    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", goAway);
    window.addEventListener("popstate", tick);
    // Первый пульс — с первым тиком, а не на монтировании: RoyApp к этому моменту успевает
    // восстановить таб и экран в адресе, и журнал не получает ложный заход на главную.
    const timer = window.setInterval(tick, PRESENCE_CHECK_MS);

    return () => {
      window.clearInterval(timer);
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", goAway);
      window.removeEventListener("popstate", tick);
    };
  }, []);

  return null;
}
