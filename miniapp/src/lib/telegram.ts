import WebApp from "@twa-dev/sdk";

export function getInitData(): string {
  if (process.env.NEXT_PUBLIC_DEV_MODE === "true") return "";
  if (typeof window === "undefined") return "";
  try {
    return WebApp.initData ?? "";
  } catch {
    return "";
  }
}

export function initApp(): void {
  if (typeof window === "undefined") return;
  try {
    WebApp.expand();
    WebApp.ready();
  } catch {
    // Not in Telegram context — expected in dev mode or plain browser preview
  }
}

// Deep-link из уведомления агента «тезисы готовы».
// Браузер: ?meeting=<id>. Telegram Mini App: startapp=meeting_<id> → start_param.
export function getDeepLinkMeetingId(): string | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get("meeting");
  if (fromQuery) return fromQuery;
  try {
    const sp = (WebApp.initDataUnsafe as { start_param?: string } | undefined)?.start_param;
    if (sp && sp.startsWith("meeting_")) return sp.slice("meeting_".length);
  } catch {
    // вне Telegram — start_param недоступен, это норм
  }
  return null;
}
