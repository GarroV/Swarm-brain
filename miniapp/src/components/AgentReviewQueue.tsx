"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAgentMeetings, deleteAgentMeeting } from "@/lib/api";
import type { AgentMeeting } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useRoyNav } from "@/components/roy/nav";

type Props = { onOpen: (id: string) => void };

// Очередь черновиков desktop-agent «на вычитке». Невидима, пока черновиков нет
// (в т.ч. до деплоя эндпоинта /agent-meetings — тогда fetch падает и очередь
// просто не показывается, остальное приложение работает). Это намеренная деградация.
export function AgentReviewQueue({ onOpen }: Props) {
  const { toast } = useRoyNav();
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

  const remove = async (m: AgentMeeting) => {
    if (typeof window !== "undefined" && !window.confirm(`Удалить черновик «${m.title ?? "Встреча"}»? Это удалит расшифровку и тезисы.`)) return;
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await deleteAgentMeeting(m.id);
      toast("Черновик удалён");
    } catch {
      toast("Не удалось удалить");
      load();
    }
  };

  if (!loaded || items.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-4 pb-2 border-b border-line">
      <div className="flex items-center gap-2 mb-2">
        <RoyIcon name="clock" size={16} strokeWidth={1.9} style={{ color: "var(--status-open)" }} />
        <h2 className="text-sm font-semibold text-ink">На вычитке · {items.length}</h2>
      </div>
      <div className="space-y-2 max-h-[40vh] overflow-y-auto">
        {items.map((m) => (
          <div key={m.id} className="relative">
            <button
              onClick={() => onOpen(m.id)}
              className="block w-full text-left p-3 pr-[84px] rounded-lg border border-line bg-card dark:backdrop-blur-sm transition-colors hover:bg-surface-2"
            >
              <p className="text-sm font-medium leading-snug line-clamp-1 text-ink">{m.title ?? "Встреча без названия"}</p>
              <p className="text-xs text-ink-soft mt-0.5">
                {(m.started_at ?? m.created_at).slice(0, 10)}
                {m.draft_notes_md === null ? " · готовим тезисы…" : ""}
              </p>
            </button>
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              <button
                type="button"
                aria-label="Изменить"
                onClick={() => onOpen(m.id)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
                style={{ color: "var(--accent-ink)" }}
              >
                <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label="Удалить"
                onClick={() => remove(m)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
                style={{ color: "var(--pri-high)" }}
              >
                <RoyIcon name="trash" size={15} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
