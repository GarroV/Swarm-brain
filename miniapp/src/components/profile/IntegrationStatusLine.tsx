"use client";
import { useDt, useLang } from "@/components/roy/nav";
import { integrationHealth, integrationStatusText } from "@/lib/integrationStatus";

/** Строка статуса в панели интеграции: «Подключён · дата» или «Не отвечает» с подсказкой (issue #921). */
export function IntegrationStatusLine({ active, lastSeenAt, staleDays, suffix }: {
  active: boolean;
  /** undefined — сервер ещё не отдаёт поле (см. lib/integrationStatus.ts). */
  lastSeenAt: string | null | undefined;
  staleDays: number;
  /** Дополнение к живому статусу, например срок токена. */
  suffix?: string | null;
}) {
  const dt = useDt();
  const locale = useLang() === "ru" ? "ru-RU" : "en-GB";
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  const health = integrationHealth({ active, lastSeenAt, staleDays, now: new Date() });
  if (health === "off") return null;
  const { label, hint } = integrationStatusText(health, lastSeenAt, dt, formatDate);
  const alive = health === "alive" || health === "unknown";

  return (
    <div className="space-y-1">
      <p className={`text-sm ${alive ? "text-status-done" : "text-status-prog"}`}>
        {alive ? "✓" : "⚠"} {label}{alive && suffix ? ` · ${suffix}` : ""}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
