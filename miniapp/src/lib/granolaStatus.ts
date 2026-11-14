import type { Integration } from "@/types";

export type GranolaCheckStatus = {
  attemptedAt: string | null;
  failed: boolean;
};

/** last_polled_at records an attempt, including a failed one (#178), not a successful sync. */
export function granolaCheckStatus(
  integrations: readonly Integration[],
): GranolaCheckStatus | null {
  const granola = integrations.find((integration) =>
    integration.service === "granola"
  );
  if (!granola) return null;
  return { attemptedAt: granola.last_polled_at, failed: !!granola.last_error };
}

export function formatGranolaAttempt(
  attemptedAt: string | null,
  locale: string,
): string | null {
  if (!attemptedAt) return null;
  const date = new Date(attemptedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
