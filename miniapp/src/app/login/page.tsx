"use client";
import { useEffect, useRef, useState } from "react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

// Понятные сообщения по кодам ошибок из /api/auth/google/callback.
const ERR_TEXT: Record<string, string> = {
  domain: "Войдите корпоративным аккаунтом @dodobrands.io.",
  not_allowed: "Этот аккаунт не в списке доступа — попросите администратора добавить вашу почту.",
  link_telegram: "Почти! Ваш аккаунт есть, но не привязан Telegram — напишите администратору.",
  state: "Сессия входа истекла — попробуйте ещё раз.",
  token: "Не удалось войти через Google — попробуйте ещё раз.",
  userinfo: "Не удалось получить данные аккаунта Google — попробуйте ещё раз.",
  resolve: "Временная ошибка входа — попробуйте ещё раз.",
};

export default function LoginPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [googleHref, setGoogleHref] = useState("/api/auth/google/start");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Пробрасываем deep-link (?next=…) через вход: только относительный same-origin путь.
    const nextRaw = params.get("next");
    let safeNext = "";
    if (nextRaw) {
      try {
        const parsed = new URL(nextRaw, window.location.origin);
        if (parsed.origin === window.location.origin) safeNext = parsed.pathname + parsed.search + parsed.hash;
      } catch { /* кривой next → без редиректа */ }
    }
    setGoogleHref(safeNext ? `/api/auth/google/start?next=${encodeURIComponent(safeNext)}` : "/api/auth/google/start");

    const e = params.get("err");
    if (e) setErr(ERR_TEXT[e] ?? "Не удалось войти — попробуйте ещё раз.");

    // Telegram Login Widget — второй способ входа.
    if (ref.current && BOT_USERNAME) {
      const authUrl = safeNext ? `/api/auth/telegram?next=${encodeURIComponent(safeNext)}` : "/api/auth/telegram";
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      script.setAttribute("data-telegram-login", BOT_USERNAME);
      script.setAttribute("data-size", "large");
      script.setAttribute("data-radius", "12");
      script.setAttribute("data-auth-url", authUrl);
      script.setAttribute("data-request-access", "write");
      ref.current.appendChild(script);
    }
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-6"
      style={{ background: "oklch(0.16 0.02 264)" }}>
      <div className="flex flex-col items-center gap-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="Swarm Brain" width={88} height={88} className="rounded-3xl" />
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">Swarm Brain</h1>
          <p className="mt-2 text-sm" style={{ color: "oklch(0.72 0.04 264)" }}>
            Командные и личные задачи
          </p>
        </div>
      </div>

      {err && (
        <div className="max-w-xs rounded-xl px-4 py-3 text-sm text-center"
          style={{ background: "oklch(0.28 0.09 25)", color: "oklch(0.9 0.05 25)" }}>
          {err}
        </div>
      )}

      <div className="flex flex-col items-center gap-4 w-full max-w-xs">
        {/* Основной способ — Google (корпоративный аккаунт dodobrands.io). */}
        <a href={googleHref}
          className="flex items-center justify-center gap-3 w-full rounded-xl bg-white py-3.5 font-semibold transition-transform active:scale-[0.99]"
          style={{ color: "oklch(0.2 0.02 264)", fontSize: 15 }}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Войти через Google
        </a>

        {/* Второй способ — Telegram. */}
        <div ref={ref} className="min-h-[48px] flex items-center justify-center" />

        {!BOT_USERNAME && (
          <p className="text-xs text-center" style={{ color: "oklch(0.7 0.1 25)" }}>
            NEXT_PUBLIC_BOT_USERNAME не задан — кнопка Telegram не отрисуется.
          </p>
        )}
      </div>
    </main>
  );
}
