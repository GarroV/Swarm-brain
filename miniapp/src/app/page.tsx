"use client";
import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/api";
import { applyBackdrop, readCachedBackdrop, resolveBackdrop } from "@/lib/backdrop";
import { getInitData } from "@/lib/telegram";
import type { Me } from "@/types";
import { RoyApp } from "@/components/roy/RoyApp";

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe()
      .then((m) => {
        setMe(m);
        // Задник — из профиля (едет между устройствами). Нет поля — сервер старый, остаётся кэш вкладки.
        if ("ui_backdrop" in m) {
          const id = resolveBackdrop(m.ui_backdrop);
          if (id !== readCachedBackdrop()) applyBackdrop(id);
        }
      })
      .catch((err: unknown) => {
        // В браузере (вне Telegram) без сессии → на страницу входа
        const status = (err as { status?: number }).status;
        if (status === 401 && !getInitData() && typeof window !== "undefined") {
          // Сохраняем deep-link (?meeting=…) через логин — иначе он теряется и юзер
          // садится на домашний экран вместо встречи из уведомления.
          const next = window.location.pathname + window.location.search + window.location.hash;
          window.location.href = "/login?next=" + encodeURIComponent(next);
        }
      });
  }, []);

  return <RoyApp me={me} />;
}
