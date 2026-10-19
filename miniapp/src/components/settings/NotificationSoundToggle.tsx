"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  isChimeEnabled,
  playChime,
  setChimeEnabled,
} from "@/lib/notificationSound";
import { useDt } from "@/components/roy/nav";

// Выключатель звука нового уведомления (issue #803). Хранится в localStorage этого браузера,
// по умолчанию включён. Нажатие «включить» заодно играет звук — это и пробный «динь», и жест
// пользователя, без которого браузер звук не отдаёт.
export function NotificationSoundToggle() {
  const dt = useDt();
  const [on, setOn] = useState(true);
  useEffect(() => setOn(isChimeEnabled()), []);

  const flip = () => {
    const next = !on;
    setOn(next);
    setChimeEnabled(next);
    if (next) playChime();
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={flip}
      className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-2"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-primary" : "bg-line-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white transition-all",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">
          {dt("Звук уведомлений", "Notification sound")}
        </span>
        <span className="block text-xs text-ink-soft">
          {dt(
            "Короткий сигнал, когда приходит новое уведомление",
            "A short chime when a new notification arrives",
          )}
        </span>
      </span>
    </button>
  );
}
