// «Опрашивать только видимую вкладку» — один код для всех фоновых обновлений (решение 13.10.2026).
// Скрытая вкладка не тикает: пустой интервал на скрытой вкладке грузит сервер впустую. При
// возврате видимости — одна догрузка (`onVisible`), чтобы человек не ждал следующего тика.

/** Минимум от document, который нужен поллингу; позволяет тестировать без браузера. */
export type PollDoc = {
  visibilityState: string;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
};

export function startVisiblePolling(
  doc: PollDoc,
  tick: () => void,
  intervalMs: number,
  onVisible: () => void = tick,
): () => void {
  const timer = setInterval(() => {
    if (doc.visibilityState === "visible") tick();
  }, intervalMs);
  const onChange = () => {
    if (doc.visibilityState === "visible") onVisible();
  };
  doc.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", onChange);
  };
}
