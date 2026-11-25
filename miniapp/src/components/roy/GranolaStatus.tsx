"use client";
import { useEffect, useState } from "react";
import { fetchIntegrations } from "@/lib/api";
import { formatGranolaAttempt, granolaCheckStatus, type GranolaCheckStatus } from "@/lib/granolaStatus";
import { useLang, useT } from "./nav";

export function GranolaStatusContent({ status, unavailable = false }: { status: GranolaCheckStatus | null; unavailable?: boolean }) {
  const t = useT();
  const lang = useLang();
  if (!status && !unavailable) return null;
  const attempt = status && formatGranolaAttempt(status.attemptedAt, lang);
  return (
    <section aria-label={t("meetings.granola.label")} data-granola-status className="shrink-0 border-b border-line px-4 py-3 text-xs text-ink-soft" role="status">
      {unavailable ? <p>{t("meetings.granola.unavailable")}</p> : status && <>
        <p className="font-medium text-ink">{t("meetings.granola.brand")}</p>
        <p>{t("meetings.granola.cadence")}</p>
        <p>{attempt ? <>{t("meetings.granola.lastAttempt")} <time dateTime={status.attemptedAt ?? undefined}>{attempt}</time></> : status.attemptedAt ? t("meetings.granola.unknownAttempt") : t("meetings.granola.noAttempt")}</p>
        {status.failed && <p className="text-destructive">{t("meetings.granola.failed")}</p>}
      </>}
    </section>
  );
}

/** Read-only status snapshot; never imports a note or calls Granola/the model directly. */
export function GranolaStatus() {
  const [status, setStatus] = useState<GranolaCheckStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    fetchIntegrations().then((integrations) => {
      if (live) setStatus(granolaCheckStatus(integrations));
    }).catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, []);
  return <GranolaStatusContent status={status} unavailable={unavailable} />;
}
