"use client";
import { useEffect, useState } from "react";
import { useDt } from "@/components/roy/nav";
import { Button } from "@/components/ui/button";
import { fetchMe, linkTelegram } from "@/lib/api";
import type { Me } from "@/types";

const POLL_MS = 3000;

/**
 * Панель плитки Telegram. Вошедший по e-mail привязывает Telegram сам (issue #92): кнопка выдаёт
 * одноразовую ссылку на бота, человек жмёт в боте «Старт», а экран ждёт, пока привязка
 * появится в /me. Бот отвечает только строкой об успехе; почему не вышло (ссылка истекла,
 * Telegram уже занят) — говорит этот экран, а не бот.
 */
export function TelegramPanel({ me }: { me: Me }) {
  const dt = useDt();
  const [linked, setLinked] = useState(me.telegram_linked ?? me.telegram_id > 0);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (waitUntil === null) return;
    const timer = setInterval(async () => {
      if (Date.now() > waitUntil) {
        setWaitUntil(null);
        setExpired(true);
        return;
      }
      try {
        const fresh = await fetchMe();
        if (fresh.telegram_linked) {
          setLinked(true);
          setWaitUntil(null);
        }
      } catch {
        // Сбой опроса не повод бросать ожидание: следующий тик спросит снова.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waitUntil]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      const { url, expires_at } = await linkTelegram();
      window.open(url, "_blank", "noopener");
      setWaitUntil(new Date(expires_at).getTime());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <p className="text-sm text-muted-foreground">
        {me.telegram_id > 0
          ? dt(
            "Telegram привязан — приходят уведомления, работает бот и запись встреч.",
            "Telegram is linked — notifications, the bot and meeting recording all work.",
          )
          : dt(
            "Telegram привязан — бот узнаёт тебя. Уведомления в Telegram подключаем следующим шагом.",
            "Telegram is linked — the bot knows you. Telegram notifications are coming next.",
          )}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {dt(
          "Вход сделан по e-mail, без Telegram: бот тебя не знает. Привяжи Telegram — откроется бот, нажми в нём «Старт».",
          "You signed in by e-mail, without Telegram, so the bot doesn't know you. Link Telegram — the bot opens, press Start there.",
        )}
      </p>
      <Button size="sm" onClick={start} disabled={busy} className="w-full">
        {waitUntil !== null ? dt("Открыть бота ещё раз", "Open the bot again") : dt("Привязать Telegram", "Link Telegram")}
      </Button>
      {waitUntil !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {dt(
            "Жду «Старт» в боте… Ссылка действует 15 минут.",
            "Waiting for Start in the bot… The link works for 15 minutes.",
          )}
        </p>
      )}
      {expired && (
        <p role="alert" className="text-xs text-destructive">
          {dt(
            "Привязка не пришла: ссылка истекла, или этот Telegram уже привязан к другому аккаунту. Попробуй ещё раз; если не выходит — напиши в фидбек.",
            "Linking didn't come through: the link expired, or this Telegram is already linked to another account. Try again; if it keeps failing, send feedback.",
          )}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
