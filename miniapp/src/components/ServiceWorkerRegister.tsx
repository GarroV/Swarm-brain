"use client";
import { useEffect } from "react";

// Регистрирует service worker (PWA-оболочка офлайн) И форсит обновление: при выходе
// нового SW (бамп версии кэша / новая логика) сразу подхватываем его и перезагружаем
// вкладку — иначе установленный PWA/закэшированный клиент залипает на старой сборке
// («все на старых рельсах»). Перезагрузка только при ОБНОВЛЕНИИ (был контроллер),
// не при первой установке; флаг refreshing — защита от цикла.
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

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Проверить наличие новой версии sw.js немедленно (а не раз в сутки).
        reg.update().catch(() => {});
      })
      .catch(() => {
        /* SW не критичен — приложение работает и без него */
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);
  return null;
}
