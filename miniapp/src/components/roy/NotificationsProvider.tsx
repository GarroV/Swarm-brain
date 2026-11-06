"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { fetchNotifications, markNotificationsRead } from "@/lib/api";
import { createNotificationFeed } from "@/lib/notificationFeed";
import { publishNotice } from "@/lib/deployNotice";
import { playChime, unreadObserver } from "@/lib/notificationSound";

const POLL_MS = 60_000;
const NotificationsContext = createContext<ReturnType<typeof createNotificationFeed> | null>(null);

/** One polling lifetime for the shell, including kept/hidden screen headers (#113). */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [feed] = useState(() => createNotificationFeed({
    load: fetchNotifications,
    read: markNotificationsRead,
    onLoaded: (response) => {
      publishNotice(response.notice ?? null);
      if (unreadObserver.observe(response.unread)) playChime();
    },
    onRead: (unread) => { unreadObserver.observe(unread); },
  }));

  useEffect(() => {
    void feed.refresh();
    const tick = () => { if (document.visibilityState === "visible") void feed.refresh(); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [feed]);

  return <NotificationsContext.Provider value={feed}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const feed = useContext(NotificationsContext);
  if (!feed) throw new Error("NotificationsProvider is required");
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  return { ...snapshot, refresh: feed.refresh, markRead: feed.markRead };
}
