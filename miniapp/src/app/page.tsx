"use client";
import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/api";
import { applyBackdrop, readCachedBackdrop, resolveBackdrop } from "@/lib/backdrop";
import { subscribeUnauthorized } from "@/lib/connection";
import type { Me } from "@/types";
import { RoyApp } from "@/components/roy/RoyApp";
import { SecondStepGate } from "@/components/roy/SecondStepGate";
import { stepPending } from "@/lib/passkeyStep";
import { McpOAuthConsent } from "@/components/McpOAuthConsent";

let redirecting = false;

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

  useEffect(() => {
    setOauthRequest(new URLSearchParams(window.location.search).get("mcp_oauth"));
    setRouteReady(true);
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
        if ((err as { status?: number }).status === 401) goToLogin();
      });
  }, []);

  // 401 от любого виджета посреди работы — тоже на вход, а не «Не загрузилось» (#467).
  useEffect(() => subscribeUnauthorized(goToLogin), []);

  // Read the consent deep link before mounting RoyApp: its navigation effects normalise the URL.
  if (!routeReady) return <main aria-busy="true" className="min-h-dvh bg-background" />;
  // Touch ID обязателен и не пройден — внутрь не пускаем: вместо приложения один экран (решение 26.10.2026).
  if (me && stepPending(me)?.required) return <SecondStepGate me={me} />;
  if (oauthRequest) {
    if (!me) return <main aria-busy="true" className="min-h-dvh bg-background" />;
    return <McpOAuthConsent requestId={oauthRequest} me={me} />;
  }
  return <RoyApp me={me} />;
}
