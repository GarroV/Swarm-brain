// Deep-link из пуша «к твоей задаче написали комментарий».
// Адрес: ?task=<id>.
export function getDeepLinkTaskId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("task") || null;
}

// Deep-link из уведомления агента «тезисы готовы».
// Адрес: ?meeting=<id>.
export function getDeepLinkMeetingId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("meeting") || null;
}
