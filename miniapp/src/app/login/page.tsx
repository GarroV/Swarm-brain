"use client";
import { useEffect, useRef, useState } from "react";

// Публичный числовой id бота @swarm_brain_bot (из Telegram embed: TWidgetLogin.init('widget_login', <id>, …)).
// Нужен для JS-метода Telegram.Login.auth (своя кнопка вместо фиксированного iframe-виджета).
const TG_BOT_ID = 8500236343;

// Понятные сообщения по кодам ошибок из /api/auth/google/callback (страница логина — на английском).
const ERR_TEXT: Record<string, string> = {
  domain: "Sign in with your corporate @dodobrands.io account.",
  not_allowed: "This account isn't on the access list — ask an admin to add your email.",
  link_telegram: "Almost there — your account exists but Telegram isn't linked yet. Ask an admin.",
  state: "Sign-in session expired — please try again.",
  token: "Couldn't sign in with Google — please try again.",
  userinfo: "Couldn't fetch your Google account — please try again.",
  resolve: "Temporary sign-in error — please try again.",
};

// Соты (Hero Patterns Hexagons), янтарь на прозрачном — фоновая текстура «улья».
const HONEYCOMB =
  "url(\"data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23D98A2B' fill-opacity='0.07' fill-rule='evenodd'/%3E%3C/svg%3E\")";

type TgUser = Record<string, string | number>;
type TgAuth = { auth: (opts: { bot_id: number; request_access?: string }, cb: (user: TgUser | false) => void) => void };

export default function LoginPage() {
  const [googleHref, setGoogleHref] = useState("/api/auth/google/start");
  const [err, setErr] = useState<string | null>(null);
  const nextRef = useRef("");

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
    nextRef.current = safeNext;
    setGoogleHref(safeNext ? `/api/auth/google/start?next=${encodeURIComponent(safeNext)}` : "/api/auth/google/start");

    const e = params.get("err");
    if (e) setErr(ERR_TEXT[e] ?? "Couldn't sign in — please try again.");

    // Грузим telegram-widget.js один раз ради JS-метода Telegram.Login.auth (без отрисовки iframe-кнопки).
    if (!document.getElementById("tg-widget-js")) {
      const s = document.createElement("script");
      s.id = "tg-widget-js";
      s.src = "https://telegram.org/js/telegram-widget.js?22";
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  // Своя Telegram-кнопка: попап Telegram → редирект на существующий GET /api/auth/telegram с данными.
  const loginTelegram = () => {
    const tg = (window as unknown as { Telegram?: { Login?: TgAuth } }).Telegram?.Login;
    if (!tg) { setErr("Telegram is still loading — try again in a second."); return; }
    tg.auth({ bot_id: TG_BOT_ID, request_access: "write" }, (user) => {
      if (!user) return; // отменил
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(user)) if (v != null) qs.set(k, String(v));
      if (nextRef.current) qs.set("next", nextRef.current);
      window.location.href = `/api/auth/telegram?${qs.toString()}`;
    });
  };

  const btnClass =
    "flex items-center justify-center gap-3 w-full rounded-2xl bg-surface py-3.5 font-semibold text-ink border border-line-2 shadow-[0_2px_10px_rgba(34,31,26,0.06)] transition-all hover:border-accent-line hover:shadow-[0_6px_20px_rgba(217,138,43,0.18)] active:scale-[0.99]";

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center gap-9 px-6 overflow-hidden"
      style={{ background: "var(--background)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HONEYCOMB }} />
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
          <p className="mt-2 text-sm text-ink-soft">Team knowledge base &amp; tasks</p>
        </div>
      </div>

      {err && (
        <div className="relative max-w-xs rounded-2xl px-4 py-3 text-sm text-center"
          style={{ background: "#FBE3DA", color: "#9A3412", border: "1px solid #F3C9BB" }}>
          {err}
        </div>
      )}

      <div className="relative flex flex-col items-center gap-3 w-full max-w-[19rem]">
        {/* Google */}
        <a href={googleHref} className={btnClass} style={{ fontSize: 15 }}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </a>

        <div className="flex items-center gap-3 w-full py-0.5">
          <span className="h-px flex-1" style={{ background: "var(--line-2)" }} />
          <span className="text-xs text-ink-mute">or</span>
          <span className="h-px flex-1" style={{ background: "var(--line-2)" }} />
        </div>

        {/* Telegram — своя кнопка того же размера */}
        <button type="button" onClick={loginTelegram} className={btnClass} style={{ fontSize: 15 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#26A5E4"/>
            <path fill="#fff" d="M5.5 11.9l11-4.24c.51-.19.96.12.79.9l-1.87 8.82c-.14.63-.52.79-1.05.49l-2.9-2.14-1.4 1.35c-.15.15-.29.29-.6.29l.21-3.03 5.5-4.97c.24-.21-.05-.33-.37-.12l-6.8 4.28-2.93-.91c-.64-.2-.65-.64.14-.95z"/>
          </svg>
          Sign in with Telegram
        </button>
      </div>

      <p className="relative text-xs text-ink-mute">Invite-only · @dodobrands.io</p>
    </main>
  );
}
