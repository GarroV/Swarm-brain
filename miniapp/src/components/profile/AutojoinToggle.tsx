"use client";
import { useEffect, useState } from "react";
import { ApiError, fetchAutojoin, setAutojoin } from "@/lib/api";
import { Toggle } from "@/components/ui/Toggle";
import { useDt } from "@/components/roy/nav";

/**
 * Автозапуск бота по календарю (D021): рядом с подключением календаря, по умолчанию выключен.
 * Включённый — бот scriba сам приходит на встречи Meet из календаря человека. Выключение действует
 * со следующего опроса службы (до минуты) и гасит уже заведённые, но не забранные задания.
 * bare — без верхней черты: переключатель стоит своей плиткой (SettingsDesk), а не под календарём.
 */
export function AutojoinToggle({ bare = false }: { bare?: boolean } = {}) {
  const dt = useDt();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAutojoin()
      .then((v) => { if (alive) setEnabled(v); })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, []);

  const flip = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setEnabled(await setAutojoin(!enabled));
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; error_ru?: string } | null) : null;
      setError(dt(body?.error_ru ?? "Не удалось сохранить, повторите", body?.error ?? "Could not save, try again"));
    } finally {
      setBusy(false);
    }
  };

  const label = dt("Бот сам приходит на мои встречи", "The bot joins my meetings on its own");

  return (
    <div className={bare ? "space-y-1" : "space-y-1 border-t border-line pt-3"}>
      <div className="flex items-center justify-between gap-3">
        <span id="autojoin-label" className="text-sm text-ink">{label}</span>
        {enabled === null
          ? <span className="text-xs text-muted-foreground">{loadFailed ? dt("Не удалось узнать настройку", "Could not load the setting") : dt("Загрузка…", "Loading…")}</span>
          : <Toggle on={enabled} onChange={flip} ariaLabel={label} className={busy ? "opacity-60" : undefined} />}
      </div>
      <p className="text-xs text-muted-foreground">
        {dt(
          "Бот scriba заходит на встречи Google Meet из твоего календаря и пишет их. Его видят все участники, в том числе внешние. Выключение действует в течение минуты.",
          "The scriba bot joins Google Meet meetings from your calendar and records them. Every participant sees it, external ones included. Turning it off takes effect within a minute.",
        )}
      </p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
