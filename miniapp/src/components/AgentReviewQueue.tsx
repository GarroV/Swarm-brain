"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAgentMeetings } from "@/lib/api";
import type { AgentMeeting } from "@/types";
import { Clock } from "lucide-react";

type Props = { onOpen: (id: string) => void };

// Очередь черновиков desktop-agent «на вычитке». Невидима, пока черновиков нет
// (в т.ч. до деплоя эндпоинта /agent-meetings — тогда fetch падает и очередь
// просто не показывается, остальное приложение работает). Это намеренная деградация.
export function AgentReviewQueue({ onOpen }: Props) {
  const [items, setItems] = useState<AgentMeeting[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAgentMeetings("awaiting_review"));
    } catch {
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!loaded || items.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-4 pb-2 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-semibold">На вычитке · {items.length}</h2>
      </div>
      <div className="space-y-2 max-h-[40vh] overflow-y-auto">
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => onOpen(m.id)}
            className="w-full text-left p-3 rounded-lg border bg-card"
          >
            <p className="text-sm font-medium leading-snug line-clamp-1">{m.title ?? "Встреча без названия"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(m.started_at ?? m.created_at).slice(0, 10)}
              {m.draft_notes_md === null ? " · готовим тезисы…" : ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
