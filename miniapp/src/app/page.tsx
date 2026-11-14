"use client";
import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/api";
import { applyBackdrop, readCachedBackdrop, resolveBackdrop } from "@/lib/backdrop";
import { readCachedScheme, resolveScheme } from "@/lib/scheme";
import { applyScheme, syncBrowserChrome } from "@/lib/theme";
import { subscribeUnauthorized } from "@/lib/connection";
import type { Me } from "@/types";
import { RoyApp } from "@/components/roy/RoyApp";
import { SecondStepGate } from "@/components/roy/SecondStepGate";
import { stepPending } from "@/lib/passkeyStep";
import { McpOAuthConsent } from "@/components/McpOAuthConsent";

let redirecting = false;

// Профиль не загрузился (сеть, 5xx): язык человека ещё неизвестен, берём язык браузера.
const LOAD_ERROR_COPY = {
  ru: { title: "Не удалось загрузить профиль", retry: "Повторить" },
  en: { title: "Could not load your profile", retry: "Retry" },
} as const;

function browserLang(): "ru" | "en" {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

/** На страницу входа, сохранив deep-link (?meeting=…): иначе после входа человек сядет на
 *  домашний экран вместо встречи из уведомления. Один раз — 401 приходят пачкой от виджетов. */
function goToLogin(): void {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.href = "/login?next=" + encodeURIComponent(next);
}

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [oauthRequest, setOauthRequest] = useState<string | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setOauthRequest(new URLSearchParams(window.location.search).get("mcp_oauth"));
    setRouteReady(true);
    syncBrowserChrome(); // цвет шапки браузера под схему из кэша (скрипт layout ставит её до гидратации)
  }, []);

  useEffect(() => {
    setLoadFailed(false);
    fetchMe()
      .then((m) => {
        setMe(m);
        // Задник — из профиля (едет между устройствами). Нет поля — сервер старый, остаётся кэш вкладки.
        if ("ui_backdrop" in m) {
          const id = resolveBackdrop(m.ui_backdrop);
          if (id !== readCachedBackdrop()) applyBackdrop(id);
        }
        // Цветовая схема — оттуда же: едет между устройствами, кэш вкладки нужен лишь первой отрисовке.
        if ("ui_scheme" in m) {
          const scheme = resolveScheme(m.ui_scheme);
          if (scheme !== readCachedScheme()) applyScheme(scheme);
        }
      })
      .catch((err: unknown) => {
        // В браузере (вне Telegram) без сессии → на страницу входа
        if ((err as { status?: number }).status === 401) goToLogin();
        // Иначе (сеть, 5xx) — не вечная заставка, а экран ошибки с повтором.
        else setLoadFailed(true);
      });
  }, [attempt]);

  // 401 от любого виджета посреди работы — тоже на вход, а не «Не загрузилось» (#467).
  useEffect(() => subscribeUnauthorized(goToLogin), []);

  // Read the consent deep link before mounting RoyApp: its navigation effects normalise the URL.
  if (loadFailed && !me) {
    const copy = LOAD_ERROR_COPY[browserLang()];
    return (
      <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-4 text-center">
        <p>{copy.title}</p>
        <button type="button" className="rounded-md border px-4 py-2" onClick={() => setAttempt((n) => n + 1)}>
          {copy.retry}
        </button>
      </main>
    );
  }
  if (!routeReady || !me) return <main aria-busy="true" className="min-h-dvh bg-background" />;
  // Touch ID обязателен и не пройден — внутрь не пускаем: вместо приложения один экран (решение 26.10.2026).
  if (me && stepPending(me)?.required) return <SecondStepGate me={me} />;
  if (oauthRequest) {
    if (!me) return <main aria-busy="true" className="min-h-dvh bg-background" />;
    return <McpOAuthConsent requestId={oauthRequest} me={me} />;
  }
  return <RoyApp me={me} />;
}
