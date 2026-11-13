"use client";
import { useEffect } from "react";

// Регистрирует service worker (PWA-оболочка офлайн) И форсит обновление: при выходе
// нового SW (бамп версии кэша / новая логика) сразу подхватываем его и перезагружаем
// вкладку — иначе установленный PWA/закэшированный клиент залипает на старой сборке
// («все на старых рельсах»). Перезагрузка только при ОБНОВЛЕНИИ (был контроллер),
// не при первой установке; флаг refreshing — защита от цикла.

// Как часто перепроверять sw.js у долго открытой вкладки. 10 минут — компромисс: раскатка
// доезжает в пределах окна, а трафик это один условный GET небольшого файла.
const UPDATE_CHECK_MS = 10 * 60 * 1000;

// DEV_MODE — локальная разработка и живая проверка (моки, npm run dev / локальная сборка).
// Service worker там вреден: cache-first для _next-статики отдаёт прошлый бандл, и проверка
// молча гоняет старый код (issue #128). Поэтому в DEV_MODE воркер не ставим, а прежний
// (оставшийся от раньше открытого прода/сборки на том же origin) снимаем вместе с кэшем.
// На проде NEXT_PUBLIC_DEV_MODE не выставлен — поведение воркера там не меняется.
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === "true";

/** Снести воркеры и кэши; true — если страница была под контролем воркера (бандл мог быть старым). */
async function purgeServiceWorker(): Promise<boolean> {
  const wasControlled = !!navigator.serviceWorker.controller;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  return wasControlled;
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (DEV_MODE) {
      // Страница уже загружена из кэша воркера — один раз перезагружаем, уже без него.
      purgeServiceWorker()
        .then((wasControlled) => { if (wasControlled) window.location.reload(); })
        .catch(() => { /* не критично: максимум остаётся старое поведение */ });
      return;
    }

    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (refreshing || !hadController) return; // первая установка — не перезагружаем
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Регулярная проверка обновления. Одного `reg.update()` при монтировании НЕ хватает:
    // сам браузер перепроверяет sw.js при НАВИГАЦИИ, а SPA не навигирует — вкладка, открытая
    // с утра, о новой сборке не узнает никогда и человек весь день работает на старом коде.
    // Ровно это и случилось 28.08.2026: потоковый разбор задач уехал на прод, а у владельца
    // в открытой вкладке ничего не изменилось. Проверка дешёвая — условный GET одного файла.
    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => registration?.update().catch(() => {});

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        checkForUpdate();
      })
      .catch(() => {
        /* SW не критичен — приложение работает и без него */
      });

    // Возврат к вкладке — самый вероятный момент, когда человек увидит обновление и когда
    // перезагрузка ему меньше всего помешает (он только что не печатал).
    const onVisible = () => { if (document.visibilityState === "visible") checkForUpdate(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
