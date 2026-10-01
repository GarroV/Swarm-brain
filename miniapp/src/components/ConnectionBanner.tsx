"use client";
// Одна плашка «нет связи с сервером» на весь экран (issue #467).
//
// Без неё обрыв сети выглядел как «Не загрузилось» в каждом виджете, и человек решал, что
// продукт сломался или данные пропали. Плашка говорит, что дело в соединении, и с какого
// времени связи нет. Гаснет сама на первом же ответе сервера (lib/connection.ts).
//
// Живёт в layout рядом с заглушкой работ, выше провайдеров языка, поэтому, как и она,
// говорит на обоих языках сразу.
import { useEffect, useState } from "react";
import { type ConnectionState, lastConnection, subscribeConnection } from "@/lib/connection";

function sinceLabel(since: number): string {
  return new Date(since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConnectionBanner() {
  const [state, setState] = useState<ConnectionState>(lastConnection);

  useEffect(() => subscribeConnection(setState), []);

  if (!state.offline || state.since == null) return null;
  const at = sinceLabel(state.since);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] border-b bg-surface px-4 py-2 text-center text-sm text-ink shadow-sm"
    >
      <span className="font-medium">No connection to the server since {at}.</span>{" "}
      <span className="text-ink-soft">
        Check your network — data on screen may be out of date. · Нет связи с сервером с {at}. Проверьте
        соединение — данные на экране могут быть устаревшими.
      </span>
    </div>
  );
}
