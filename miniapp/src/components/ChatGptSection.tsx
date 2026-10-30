"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useIsDemo, useLang } from "@/components/roy/nav";
import { fetchMcpConnections, revokeMcpConnection } from "@/lib/mcp-oauth-api";
import {
  MCP_CONNECTIONS_CHANGED,
  type McpConnections,
  type McpOAuthConnection,
} from "@/lib/mcp-oauth";
import { mcpOAuthMessages } from "@/lib/mcp-oauth-messages";

/** Личное подключение ChatGPT: адрес вместо команды установки, собственные OAuth-согласия. */
export function ChatGptSection() {
  const lang = useLang();
  const t = mcpOAuthMessages(lang);
  const demo = useIsDemo();
  const confirm = useConfirm();
  const [data, setData] = useState<McpConnections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMcpConnections());
      window.dispatchEvent(new Event(MCP_CONNECTIONS_CHANGED));
    } catch {
      setError(t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (demo) return;
    void reload();
  }, [demo, reload]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.mcpUrl);
      setCopied(true);
      setError(null);
    } catch {
      setError(t.copyFailed);
    }
  };

  const disconnect = async (connection: McpOAuthConnection) => {
    if (
      !await confirm({
        title: t.disconnectTitle,
        description: t.disconnectDescription,
        confirmText: t.disconnect,
        cancelText: t.cancel,
      })
    ) return;
    setDisconnecting(connection.id);
    setError(null);
    try {
      await revokeMcpConnection(connection.id);
      setData((current) =>
        current
          ? {
            ...current,
            connections: current.connections.filter((c) =>
              c.id !== connection.id
            ),
          }
          : current
      );
      window.dispatchEvent(new Event(MCP_CONNECTIONS_CHANGED));
    } catch {
      setError(t.disconnectFailed);
    } finally {
      setDisconnecting(null);
    }
  };

  if (demo) return <p className="text-sm text-ink-soft">{t.demoNotice}</p>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-soft">{t.introduction}</p>
      <ol className="list-decimal space-y-2 pl-4 text-ink-soft">
        {t.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {data && (
        <div className="space-y-2">
          <label
            className="block text-xs text-ink-mute"
            htmlFor="chatgpt-mcp-address"
          >
            {t.serverAddress}
          </label>
          <input
            id="chatgpt-mcp-address"
            readOnly
            value={data.mcpUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-2 font-mono text-xs text-ink"
          />
          <Button type="button" size="sm" variant="secondary" onClick={copy}>
            {copied ? t.copied : t.copyAddress}
          </Button>
        </div>
      )}
      <p className="text-xs text-ink-mute">{t.workspaceNote}</p>
      <a
        href="https://chatgpt.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-primary underline underline-offset-4"
      >
        {t.openChatGpt}
      </a>
      <div className="space-y-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-ink">{t.connectedApps}</h3>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={loading}
            onClick={() => void reload()}
          >
            {t.refresh}
          </Button>
        </div>
        {loading && (
          <p role="status" className="text-xs text-ink-mute">{t.loading}</p>
        )}
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-destructive">{error}</p>
            {!data && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void reload()}
              >
                {t.retry}
              </Button>
            )}
          </div>
        )}
        {!loading && data?.connections.length === 0 && (
          <p className="text-xs text-ink-mute">{t.none}</p>
        )}
        {data && data.connections.length > 0 && (
          <ul className="space-y-2">
            {data.connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-line p-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium text-ink">
                    {connection.clientName}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {Date.parse(connection.expiresAt) <= Date.now()
                      ? t.expired
                      : connection.lastSeenAt
                      ? `${t.lastSeen}: ${
                        new Date(connection.lastSeenAt).toLocaleString(lang)
                      }`
                      : t.awaiting}
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disconnecting !== null}
                  onClick={() => void disconnect(connection)}
                >
                  {disconnecting === connection.id
                    ? t.disconnecting
                    : t.disconnect}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
