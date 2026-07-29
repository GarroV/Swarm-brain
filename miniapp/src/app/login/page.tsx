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

// Соты (Hero Patterns Hexagons), янтарь на прозрачном — фоновая текстура «улья».
const HONEYCOMB =
  "url(\"data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23D98A2B' fill-opacity='0.07' fill-rule='evenodd'/%3E%3C/svg%3E\")";

export default function LoginPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [googleHref, setGoogleHref] = useState("/api/auth/google/start");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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

    if (ref.current && BOT_USERNAME) {
      const authUrl = safeNext ? `/api/auth/telegram?next=${encodeURIComponent(safeNext)}` : "/api/auth/telegram";
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      script.setAttribute("data-telegram-login", BOT_USERNAME);
      script.setAttribute("data-size", "medium");
      script.setAttribute("data-radius", "14");
      script.setAttribute("data-auth-url", authUrl);
      script.setAttribute("data-request-access", "write");
      ref.current.appendChild(script);
    }
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center gap-9 px-6 overflow-hidden"
      style={{ background: "var(--background)" }}>
      {/* Текстура сот */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HONEYCOMB }} />
      {/* Тёплое янтарное свечение сверху */}
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-[36rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(217,138,43,0.28), transparent)" }} />

      <div className="relative flex flex-col items-center gap-5 text-center">
        <div className="relative">
          <div aria-hidden className="absolute inset-0 rounded-[28px] blur-2xl"
            style={{ background: "rgba(217,138,43,0.35)", transform: "scale(1.15)" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="Swarm Brain" width={92} height={92}
            className="relative rounded-[24px] shadow-[0_10px_40px_rgba(154,94,18,0.25)]" />
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-ink">Swarm Brain</h1>
          <p className="mt-2 text-sm text-ink-soft">Командная база знаний и задачи</p>
        </div>
      </div>

      {err && (
        <div className="relative max-w-xs rounded-2xl px-4 py-3 text-sm text-center"
          style={{ background: "#FBE3DA", color: "#9A3412", border: "1px solid #F3C9BB" }}>
          {err}
        </div>
      )}

      <div className="relative flex flex-col items-center gap-4 w-full max-w-[19rem]">
        {/* Основной вход — Google (наша кнопка). */}
        <a href={googleHref}
          className="group flex items-center justify-center gap-3 w-full rounded-2xl bg-surface py-3.5 font-semibold text-ink border border-line-2 shadow-[0_2px_10px_rgba(34,31,26,0.06)] transition-all hover:border-accent-line hover:shadow-[0_6px_20px_rgba(217,138,43,0.18)] active:scale-[0.99]"
          style={{ fontSize: 15 }}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Войти через Google
        </a>

        {/* Разделитель */}
        <div className="flex items-center gap-3 w-full py-0.5">
          <span className="h-px flex-1" style={{ background: "var(--line-2)" }} />
          <span className="text-xs text-ink-mute">или</span>
          <span className="h-px flex-1" style={{ background: "var(--line-2)" }} />
        </div>

        {/* Второй вход — Telegram (виджет Telegram, вид фиксирован платформой). */}
        <div ref={ref} className="min-h-[40px] flex items-center justify-center" />

        {!BOT_USERNAME && (
          <p className="text-xs text-center text-ink-mute">Telegram-вход недоступен (нет NEXT_PUBLIC_BOT_USERNAME).</p>
        )}
      </div>

      <p className="relative text-xs text-ink-mute">Доступ по приглашению · @dodobrands.io</p>
    </main>
  );
}
