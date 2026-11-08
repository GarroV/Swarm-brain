"use client";
import { useEffect, useState } from "react";
import { fetchIntegrations, fetchMe, openGoogleConnect, patchMe } from "@/lib/api";
import { Toggle } from "@/components/ui/Toggle";
import { useDt } from "@/components/roy/nav";

/**
 * Авто-старт записи рекордером по календарю (#219): `user_profiles.recorder_auto_start`
 * (GET/PATCH /me), по умолчанию ВКЛЮЧЕНО (решение 18.09.2026: плановый созвон стартует сам, как у
 * Granola). Рекордер читает флаг из meeting-current и перед стартом показывает 5-секундный отсчёт с
 * отменой; то же значение переключается из меню рекордера (POST meeting-current/auto-start).
 * Без Google-календаря рекордеру неоткуда узнать о встречах — говорим об этом прямо, с кнопкой
 * подключения, а не оставляем переключатель, который молча ничего не делает. В демо записи нет.
 */
export function RecorderAutostartToggle() {
  const dt = useDt();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [hasCalendar, setHasCalendar] = useState<boolean | null>(null);
  const [demo, setDemo] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchMe(), fetchIntegrations().catch(() => null)])
      .then(([me, integrations]) => {
        if (!alive) return;
        setDemo(me.is_demo === true);
        setEnabled(me.recorder_auto_start !== false);
        // Список не загрузился — не пугаем «нужен календарь» по неизвестному.
        setHasCalendar(integrations ? integrations.some((i) => i.service === "google_calendar") : null);
      })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, []);

  if (demo) return null;

  const flip = async () => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    try {
      await patchMe({ recorder_auto_start: next });
      setEnabled(next);
    } catch {
      setError(dt("Не удалось сохранить, повторите", "Could not save, try again"));
    } finally {
      setBusy(false);
    }
  };

  const label = dt(
    "Рекордер сам начинает запись встречи по календарю",
    "Recorder starts recording calendar meetings automatically",
  );

  return (
    <div className="space-y-1 border-b border-line pb-3">
      <div className="flex items-center justify-between gap-3">
        <span id="recorder-autostart-label" className="text-sm text-ink">{label}</span>
        {enabled === null
          ? <span className="text-xs text-muted-foreground">{loadFailed ? dt("Не удалось узнать настройку", "Could not load the setting") : dt("Загрузка…", "Loading…")}</span>
          : <Toggle on={enabled} onChange={flip} ariaLabel={label} className={busy ? "opacity-60" : undefined} />}
      </div>
      <p className="text-xs text-muted-foreground">
        {dt(
          "Когда вы подключились к созвону из календаря, запись начнётся после 5-секундного отсчёта — его можно отменить",
          "When you join a call from your calendar, recording starts after a 5-second countdown — you can cancel it",
        )}
      </p>
      {hasCalendar === false && (
        <div role="status" className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line-2 bg-surface-2 px-3 py-2.5 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          <p>
            {dt(
              "Нужен подключённый Google Календарь: рекордер узнаёт о встречах из него. Без календаря авто-старт не сработает.",
              "A connected Google Calendar is required: the recorder learns about meetings from it. Without a calendar auto-start will not run.",
            )}
          </p>
          <button
            type="button"
            onClick={() => void openGoogleConnect()}
            className="self-start rounded-full bg-primary px-3.5 py-1.5 font-semibold text-primary-foreground transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ fontSize: 12.5 }}
          >
            {dt("Подключить календарь", "Connect calendar")}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
