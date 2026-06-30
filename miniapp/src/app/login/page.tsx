"use client";
import { useEffect, useRef } from "react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

export default function LoginPage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !BOT_USERNAME) return;
    // Пробрасываем deep-link (?meeting=…) дальше: /login?next=… → auth-url?next=…,
    // чтобы после входа вернуться на встречу, а не на «/». Только относительный путь.
    const nextRaw = new URLSearchParams(window.location.search).get("next");
    let safeNext = "";
    if (nextRaw) {
      try {
        const parsed = new URL(nextRaw, window.location.origin);
        if (parsed.origin === window.location.origin) safeNext = parsed.pathname + parsed.search + parsed.hash;
      } catch { /* кривой next → без редиректа */ }
    }
    const authUrl = safeNext
      ? `/api/auth/telegram?next=${encodeURIComponent(safeNext)}`
      : "/api/auth/telegram";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    ref.current.appendChild(script);
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

      <div ref={ref} className="min-h-[48px] flex items-center justify-center" />

      {!BOT_USERNAME && (
        <p className="text-xs text-center max-w-xs" style={{ color: "oklch(0.7 0.1 25)" }}>
          NEXT_PUBLIC_BOT_USERNAME не задан — кнопка входа не отрисуется.
        </p>
      )}
    </main>
  );
}
