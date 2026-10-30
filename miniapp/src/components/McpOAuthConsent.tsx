"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  decideMcpAuthorization,
  fetchMcpAuthorization,
} from "@/lib/mcp-oauth-api";
import { type McpOAuthAuthorization, safeOAuthRedirect } from "@/lib/mcp-oauth";
import { mcpOAuthMessages } from "@/lib/mcp-oauth-messages";
import type { Me } from "@/types";

/** Home показывает согласие только после обычного входа и обязательного второго шага. */
export function McpOAuthConsent(
  { requestId, me }: { requestId: string; me: Me },
) {
  // Match the app's useLang/useDt: regular workspace UI is Russian, the demo is English.
  const t = mcpOAuthMessages(me.is_demo ? "en" : "ru");
  const [request, setRequest] = useState<McpOAuthAuthorization | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setRequest(null);
    setFailed(false);
    setError(null);
    fetchMcpAuthorization(requestId).then((result) => {
      if (active) setRequest(result);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [requestId]);

  const decide = async (accept: boolean) => {
    if (!request || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await decideMcpAuthorization(request.requestId, accept);
      if (!safeOAuthRedirect(result.redirectUrl)) {
        setError(t.invalidRedirect);
        setSubmitting(false);
        return;
      }
      window.location.assign(result.redirectUrl);
    } catch {
      setError(t.consentSubmitFailed);
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <section
        aria-labelledby="mcp-consent-title"
        className="w-full max-w-lg space-y-5 rounded-2xl border border-line bg-card p-5 sm:p-7"
      >
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-mute">SwarmBrain</p>
          <h1 id="mcp-consent-title" className="text-xl font-semibold text-ink">
            {t.consentTitle}
          </h1>
          <p className="text-sm text-ink-soft">{t.consentIntro}</p>
        </div>
        {!request && !failed && (
          <p role="status" className="text-sm text-ink-soft">{t.loading}</p>
        )}
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t.consentFailed}
          </p>
        )}
        {request && (
          <>
            <dl className="space-y-3 rounded-xl border border-line bg-surface p-3 text-sm">
              <ConsentField title={t.application} value={request.clientName} />
              <ConsentField title={t.returnTo} value={request.redirectHost} />
              <ConsentField title={t.workspace} value={request.workspaceName} />
              <ConsentField
                title={t.account}
                value={me.name || me.username || String(me.telegram_id)}
              />
            </dl>
            <p className="text-sm text-ink-soft">{t.permissions}</p>
            <p className="text-xs leading-relaxed text-ink-mute">
              {t.unverified}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => void decide(false)}
              >
                {t.deny}
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void decide(true)}
              >
                {submitting ? t.submitting : t.allow}
              </Button>
            </div>
          </>
        )}
        {failed && (
          <a
            href="/"
            className="inline-block text-sm text-primary underline underline-offset-4"
          >
            {t.back}
          </a>
        )}
      </section>
    </main>
  );
}

function ConsentField({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-mute">{title}</dt>
      <dd className="mt-0.5 break-words font-medium text-ink">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
