"use client";
import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/api";
import { getInitData } from "@/lib/telegram";
import type { Me } from "@/types";
import { RoyApp } from "@/components/roy/RoyApp";

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe()
      .then(setMe)
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
