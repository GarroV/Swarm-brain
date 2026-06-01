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
