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
          window.location.href = "/login";
        }
      });
  }, []);

  return <RoyApp me={me} />;
}
