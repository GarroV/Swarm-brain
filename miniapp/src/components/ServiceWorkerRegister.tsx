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

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

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
