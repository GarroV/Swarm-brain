"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRoyNav, useDt } from "./nav";
import { RoyIcon } from "./icons";
import { cn } from "@/lib/utils";
import { fetchNotifications, markNotificationsRead, fetchTask, type SwarmNotification } from "@/lib/api";

// Колокольчик уведомлений: бейдж непрочитанных + поповер-лента, клик по строке открывает
// задачу. Поведение и оформление поповера — как у ProfileMenu (клик-вне, Esc, тот же попап),
// чтобы в оболочке было два одинаковых угловых контрола, а не два разных.

// Опрос вместо realtime: клиент не ходит в базу напрямую (RLS deny-all, см. CLAUDE.md),
// поэтому подписки Supabase недоступны — только периодический запрос к swarm-api.
const POLL_MS = 60_000;
const BADGE_MAX = 9;

function fmtWhen(iso: string, dt: (ru: string, en: string) => string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return dt("только что", "just now");
  if (mins < 60) return dt(`${mins} мин`, `${mins}m`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return dt(`${hours} ч`, `${hours}h`);
  const days = Math.floor(hours / 24);
  if (days === 1) return dt("вчера", "yesterday");
  if (days < 7) return dt(`${days} дн`, `${days}d`);
  return new Date(iso).toLocaleDateString(dt("ru-RU", "en-GB"), { day: "numeric", month: "short" });
}

export function NotificationsBell({ className }: { className?: string }) {
  const { openTask, toast } = useRoyNav();
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SwarmNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchNotifications();
      if (!alive.current) return;
      setItems(res.items);
      setUnread(res.unread);
    } catch {
      // Тихо: колокольчик — фоновая поверхность, сеть моргнула → покажем на следующем тике.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    // Пока вкладка скрыта, не опрашиваем: фоновые вкладки иначе держат постоянный трафик.
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();   // открыли — показываем свежее, а не то, что осталось с прошлого тика
  };

  const markAllRead = async () => {
    if (unread === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    try {
      await markNotificationsRead();
    } catch {
      toast(dt("Не удалось отметить прочитанным", "Could not mark as read"));
      void load();   // откатываемся к серверному состоянию, а не оставляем ложный ноль
    }
  };

  const openFromNotification = async (n: SwarmNotification) => {
    setOpen(false);
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markNotificationsRead([n.id]).catch(() => void load());
    }
    if (!n.task_id) return;
    setLoading(true);
    try {
      openTask(await fetchTask(n.task_id));
    } catch {
      toast(dt("Задача недоступна", "Task unavailable"));
    } finally {
      setLoading(false);
    }
  };

  const badge = unread > BADGE_MAX ? `${BADGE_MAX}+` : String(unread);

  return (
    <div className={cn("relative", className)}>
      {open && (
        <>
          <button
            type="button"
            aria-label={dt("Закрыть уведомления", "Close notifications")}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={dt("Уведомления", "Notifications")}
            className={cn(
              "z-50 flex flex-col overflow-hidden rounded-[20px] border border-line bg-[var(--popover)] shadow-[0_24px_64px_-18px_rgba(0,0,0,.5)] dark:backdrop-blur-xl",
              // Мобайл: кнопка стоит у правого края, и поповер шириной 380px, привязанный к ней,
              // уезжает за ЛЕВЫЙ край экрана. Поэтому во всю ширину с полями; top — высота
              // мобильной шапки SearchScreen (pt-3 + аватар 36 + pb-2 = 56) плюс зазор.
              "fixed inset-x-3 top-[58px]",
              // Десктоп (lg+ — там живут полоса «← Главная» и дашборд): обычный поповер от кнопки.
              "lg:absolute lg:inset-x-auto lg:right-0 lg:top-full lg:mt-2 lg:w-[380px]",
            )}
            style={{ maxHeight: "min(520px, 70vh)" }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-semibold text-ink" style={{ fontSize: 14 }}>
                {dt("Уведомления", "Notifications")}
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="font-semibold text-primary transition-opacity hover:opacity-70"
                  style={{ fontSize: 12 }}
                >
                  {dt("Прочитать все", "Mark all read")}
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-ink-mute" style={{ fontSize: 13 }}>
                  {dt("Пока ничего нет", "Nothing yet")}
                </p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    disabled={loading}
                    onClick={() => void openFromNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2 disabled:opacity-60",
                      !n.read_at && "bg-primary/5",
                    )}
                  >
                    {/* Точка непрочитанного держит колонку и у прочитанных — иначе текст «прыгает». */}
                    <span
                      aria-hidden
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold text-ink" style={{ fontSize: 13 }}>
                          {n.task_title || dt("Задача", "Task")}
                        </span>
                        <span className="shrink-0 text-ink-mute" style={{ fontSize: 11 }}>
                          {fmtWhen(n.created_at, dt)}
                        </span>
                      </span>
                      {/* Две строки максимум: лента остаётся сканируемой, полный текст — в задаче.
                          line-clamp именно на этом span, а не на вложенном: вложенный становится
                          -webkit-box и уносит текст на строку ниже имени автора. */}
                      <span className="mt-0.5 line-clamp-2 text-ink-soft" style={{ fontSize: 12.5 }}>
                        <span className="font-semibold">{n.actor_name}</span>{": "}{n.content}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0
            ? dt(`Уведомления, непрочитанных: ${unread}`, `Notifications, ${unread} unread`)
            : dt("Уведомления", "Notifications")
        }
        aria-expanded={open}
        className="relative flex items-center rounded-[12px] border border-line bg-surface p-2 shadow-[0_4px_14px_-8px_rgba(60,45,20,.4)] transition-colors hover:bg-surface-2 active:scale-[0.97] dark:backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <RoyIcon name="bell" size={20} className="text-ink-soft" />
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 flex min-w-[17px] items-center justify-center rounded-full bg-primary px-1 font-bold text-white"
            style={{ fontSize: 10, height: 17, lineHeight: "17px" }}
          >
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
