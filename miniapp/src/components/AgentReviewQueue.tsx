"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAgentMeetings, deleteAgentMeeting } from "@/lib/api";
import type { AgentMeeting } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { SwipeRow } from "@/components/roy/SwipeRow";
import { useConfirm } from "@/components/ui/confirm";
import { hasDraftNotes } from "@/lib/agentMeeting";

type Props = { onOpen: (id: string) => void };

// Дата в очереди печаталась ISO-срезом (2026-06-12), а в списке ниже — «12 июн.»: один экран
// с двумя форматами. Формат один — как в остальных списках встреч.
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// Очередь черновиков desktop-agent «на вычитке». Невидима, пока черновиков нет
// (в т.ч. до деплоя эндпоинта /agent-meetings — тогда fetch падает и очередь
// просто не показывается, остальное приложение работает). Это намеренная деградация.
export function AgentReviewQueue({ onOpen }: Props) {
  const { toast } = useRoyNav();
  const dt = useDt();
  // На мобайле действия строки — свайпом, как везде: «карандаш» тут вообще дублировал тап
  // (обе кнопки звали onOpen), а «корзина» стояла мелкой целью в 8px от него.
  const isDesktop = useIsDesktop();
  const confirm = useConfirm();
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
    if (!(await confirm({ title: `Удалить черновик «${m.title ?? "Встреча"}»?`, description: "Расшифровка и тезисы будут удалены без возможности восстановления." }))) return;
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
        {items.map((m) => {
          const card = (
            <button
              onClick={isDesktop ? () => onOpen(m.id) : undefined}
              className={`block w-full text-left p-3 rounded-lg border border-line bg-card dark:backdrop-blur-sm transition-colors hover:bg-surface-2 ${isDesktop ? "pr-[84px]" : ""}`}
            >
              <p className="text-sm font-medium leading-snug line-clamp-1 text-ink">{m.title ?? "Встреча без названия"}</p>
              <p className="text-xs text-ink-soft mt-0.5">
                {/* Формат даты — общий («12 июн.»), признак готовности тезисов — hasDraftNotes из
                    main: списочный /agent-meetings больше не возвращает текст тезисов (#108),
                    поэтому проверять draft_notes_md напрямую нельзя. */}
                {fmtDate(m.started_at ?? m.created_at)}
                {hasDraftNotes(m) ? "" : " · готовим тезисы…"}
              </p>
            </button>
          );
          if (!isDesktop) {
            return (
              <SwipeRow
                key={m.id}
                onTap={() => onOpen(m.id)}
                actions={[{ icon: "trash", label: dt("Удалить", "Delete"), color: "var(--pri-high)", onClick: () => remove(m) }]}
              >
                {card}
              </SwipeRow>
            );
          }
          return (
            <div key={m.id} className="relative">
              {card}
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Изменить"
                  onClick={() => onOpen(m.id)}
                  className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
                  style={{ color: "var(--accent-ink)" }}
                >
                  <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  aria-label="Удалить"
                  onClick={() => remove(m)}
                  className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
                  style={{ color: "var(--pri-high)" }}
                >
                  <RoyIcon name="trash" size={15} strokeWidth={1.9} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
