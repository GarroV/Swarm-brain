"use client";
import { useEffect, useState } from "react";
import { fetchIntegrations } from "@/lib/api";
import { formatGranolaAttempt, granolaCheckStatus, type GranolaCheckStatus } from "@/lib/granolaStatus";
import { useDt } from "./nav";

const COPY = {
  label: { ru: "Статус Granola", en: "Granola status" },
  cadence: { ru: "Проверка новых заметок запланирована раз в час.", en: "Checks for new notes are scheduled hourly." },
  lastAttempt: { ru: "Последняя попытка:", en: "Last attempt:" },
  noAttempt: { ru: "Попыток проверки ещё нет.", en: "No check has been recorded yet." },
  unknownAttempt: { ru: "Время последней попытки неизвестно.", en: "The last attempt time is unknown." },
  failed: { ru: "Последняя проверка не удалась. Новые заметки могут не появиться.", en: "The last check failed. New notes may not appear." },
  unavailable: { ru: "Granola: статус недоступен. Попробуйте обновить страницу.", en: "Granola status is unavailable. Try reloading the page." },
} as const;

export function GranolaStatusContent({ status, unavailable = false }: { status: GranolaCheckStatus | null; unavailable?: boolean }) {
  const dt = useDt();
  if (!status && !unavailable) return null;
  const attempt = status && formatGranolaAttempt(status.attemptedAt, dt("ru-RU", "en-GB"));
  return (
    <section aria-label={dt(COPY.label.ru, COPY.label.en)} data-granola-status className="shrink-0 border-b border-line px-4 py-3 text-xs text-ink-soft" role="status">
      {unavailable ? <p>{dt(COPY.unavailable.ru, COPY.unavailable.en)}</p> : status && <>
        <p className="font-medium text-ink">Granola</p>
        <p>{dt(COPY.cadence.ru, COPY.cadence.en)}</p>
        <p>{attempt ? <>{dt(COPY.lastAttempt.ru, COPY.lastAttempt.en)} <time dateTime={status.attemptedAt ?? undefined}>{attempt}</time></> : status.attemptedAt ? dt(COPY.unknownAttempt.ru, COPY.unknownAttempt.en) : dt(COPY.noAttempt.ru, COPY.noAttempt.en)}</p>
        {status.failed && <p className="text-destructive">{dt(COPY.failed.ru, COPY.failed.en)}</p>}
      </>}
    </section>
  );
}

/** Read-only status snapshot; never imports a note or calls Granola/the model directly. */
export function GranolaStatus() {
  const [status, setStatus] = useState<GranolaCheckStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    fetchIntegrations().then((integrations) => {
      if (live) setStatus(granolaCheckStatus(integrations));
    }).catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, []);
  return <GranolaStatusContent status={status} unavailable={unavailable} />;
}
