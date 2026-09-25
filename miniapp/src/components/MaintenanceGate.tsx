"use client";
// Заглушка «идут работы» — единственный экран, который человек видит, пока система заморожена.
//
// Зачем режим вообще: плашка «скоро обновление» ПРЕДУПРЕЖДАЕТ, но ничего не запрещает, и на
// крупном переезде человек продолжает править данные ровно тогда, когда меняется схема или
// уезжает новый веб. Заморозка честно останавливает работу: сервер отвечает 503 + Retry-After,
// экран объясняет, что происходит и сколько ждать.
//
// Живёт в layout, ВЫШЕ провайдеров: заглушка обязана показываться и тому, у кого протухла
// сессия. Иначе вместо «идут работы» человек получает экран входа и решает, что сломался он.
//
// Срок гасит режим сам: и сервер, и этот экран считают заморозку законченной после `until`.
// Забытая заморозка — это лежащий продукт, поэтому страховка стоит с обеих сторон.
import { useCallback, useEffect, useState } from "react";
import { fetchMaintenance } from "@/lib/api";
import {
  isMaintenanceActive,
  lastMaintenance,
  type Maintenance,
  minutesLeft,
  publishMaintenance,
  subscribeMaintenance,
} from "@/lib/maintenance";

/** Пока всё работает, спрашиваем редко: это фон, а не функция продукта. */
const POLL_IDLE_MS = 60_000;
/** Во время работ — часто, чтобы снятие заморозки дошло до людей за секунды, а не за минуту. */
const POLL_FROZEN_MS = 10_000;

/** Предпросмотр заглушки без прода: `?freeze-preview=1`. Нужен, чтобы её вид можно было
 *  проверить в браузере, не замораживая живую систему. */
function previewState(): Maintenance | null {
  if (typeof window === "undefined") return null;
  if (!new URLSearchParams(window.location.search).has("freeze-preview")) {
    return null;
  }
  return {
    until: new Date(Date.now() + 20 * 60_000).toISOString(),
    message_en: "Swarm is being updated. Your data is safe — please come back in a few minutes.",
    message_ru: "Идёт обновление Swarm. Данные на месте — зайдите, пожалуйста, через несколько минут.",
  };
}

export function MaintenanceGate() {
  const [state, setState] = useState<Maintenance | null>(lastMaintenance);
  const [now, setNow] = useState(() => new Date());
  // Предпросмотр живёт отдельным состоянием и перебивает ответы сервера: иначе первый же
  // опрос («работаем») гасит заглушку, и проверить её вид невозможно.
  const [preview, setPreview] = useState<Maintenance | null>(null);

  useEffect(() => {
    setPreview(previewState());
  }, []);

  useEffect(() => subscribeMaintenance(setState), []);

  const poll = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fetchMaintenance().then(publishMaintenance).catch(() => {
      /* тихо: недоступный статус — не повод пугать человека заглушкой */
    });
  }, []);

  const shown = preview ?? state;
  const active = isMaintenanceActive(shown, now);

  useEffect(() => {
    if (preview) return; // в предпросмотре сервер не спрашиваем
    poll();
    const id = setInterval(poll, active ? POLL_FROZEN_MS : POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [poll, active, preview]);

  // Тикаем, чтобы заглушка снялась по сроку даже без ответа сервера.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!active || !shown) return null;

  const left = minutesLeft(shown, now);

  // Владелец проходит сквозь заморозку — ему нужна не заглушка, а напоминание, что для
  // остальных система сейчас закрыта.
  if (shown.bypass) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[100] bg-primary px-4 py-1.5 text-center text-xs font-medium text-white"
      >
        Maintenance mode is on for everyone else (~{left} min) · Режим работ включён для
        остальных — вы проходите
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Maintenance in progress"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-6 text-center"
    >
      <div className="max-w-md space-y-5">
        <div
          aria-hidden
          className="mx-auto size-10 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <p className="text-lg font-semibold text-foreground">{shown.message_en}</p>
        <p className="text-base text-muted-foreground">{shown.message_ru}</p>
        <p className="text-sm text-muted-foreground">
          Back in ~{left} min · Вернёмся примерно через {left} мин
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-card"
        >
          Refresh · Обновить
        </button>
      </div>
    </div>
  );
}
