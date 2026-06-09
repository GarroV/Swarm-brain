"use client";
import { useEffect } from "react";

// Регистрирует service worker для офлайн-доступа к оболочке приложения (PWA).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW не критичен — приложение работает и без него */
      });
    }
  }, []);
  return null;
}
