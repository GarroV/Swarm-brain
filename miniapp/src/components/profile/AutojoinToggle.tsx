"use client";
import { useEffect, useState } from "react";
import { ApiError, type AutojoinCalendarCheck, fetchAutojoinState, openGoogleConnect, setAutojoin } from "@/lib/api";
import { autojoinNotice, type NoticeTone } from "@/lib/autojoinNotice";
import { Toggle } from "@/components/ui/Toggle";
import { useDt, useLang } from "@/components/roy/nav";

/**
 * Автозапуск бота по календарю (D021): панель карточки «Бот встреч» в интеграциях, по умолчанию
 * выключен (карточкой, а не внутри календаря — владелец 30.09.2026: там переключатель не находили).
 * Включённый — бот scriba сам приходит на встречи Meet из календаря человека. Выключение действует
 * со следующего опроса службы (до минуты) и гасит уже заведённые, но не забранные задания.
 * bare — в правой колонке интеграций: без черты и без пояснения (объяснение уже над переключателем);
 * onChange — сохранённое значение наружу.
 *
 * Включённому — живая проверка календаря под переключателем (решение 01.10.2026): сервер сходил в
 * Google тем же путём, что обход автозапуска, и сказал, видит ли бот встречи. Не «коннектор есть».
 */
export function AutojoinToggle({ bare = false, onChange }: { bare?: boolean; onChange?: (on: boolean) => void } = {}) {
  const dt = useDt();
  const lang = useLang();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [calendar, setCalendar] = useState<AutojoinCalendarCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAutojoinState()
      .then((v) => {
        if (!alive) return;
        setEnabled(v.enabled);
        setCalendar(v.calendar ?? null);
      })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, []);

  const flip = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await setAutojoin(!enabled);
      setEnabled(saved.enabled);
      setCalendar(saved.calendar ?? null);
      onChange?.(saved.enabled);
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
      {!bare && <p className="text-xs text-muted-foreground">
        {dt(
          "Бот scriba заходит на встречи Google Meet из твоего календаря и пишет их. Его видят все участники, в том числе внешние. Выключение действует в течение минуты.",
          "The scriba bot joins Google Meet meetings from your calendar and records them. Every participant sees it, external ones included. Turning it off takes effect within a minute.",
        )}
      </p>}
      {enabled && calendar && <CalendarNotice check={calendar} lang={lang} />}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

const TONE: Record<NoticeTone, string> = {
  warn: "border-destructive/40 bg-destructive/10 text-ink",
  soft: "border-line-2 bg-surface-2 text-ink-soft",
  ok: "border-line-2 bg-surface text-ink-soft",
};

/** Итог живой проверки календаря. Без доступа — громко и с кнопкой подключить (D015: отказ не молчит). */
function CalendarNotice({ check, lang }: { check: AutojoinCalendarCheck; lang: "ru" | "en" }) {
  const dt = useDt();
  const n = autojoinNotice(check, lang);
  return (
    <div
      role={n.tone === "warn" ? "alert" : "status"}
      className={`mt-2 flex flex-col gap-2 rounded-[10px] border px-3 py-2.5 ${TONE[n.tone]}`}
      style={{ fontSize: 12.5, lineHeight: 1.45 }}
    >
      <p className="flex items-start gap-1.5">
        {n.tone === "ok" && <span aria-hidden className="text-status-done">✓</span>}
        <span>{n.text}</span>
      </p>
      {n.connect && (
        <button
          type="button"
          onClick={() => void openGoogleConnect()}
          className="self-start rounded-full bg-primary px-3.5 py-1.5 font-semibold text-primary-foreground transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 12.5 }}
        >
          {dt("Подключить календарь", "Connect calendar")}
        </button>
      )}
    </div>
  );
}
