"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { fetchChatGptDesktop, mintChatGptDesktop, revokeChatGptDesktop, type DesktopMcpStatus } from "@/lib/chatgpt-desktop";
import { MCP_CONNECTIONS_CHANGED } from "@/lib/mcp-oauth";
import { mcpOAuthMessages } from "@/lib/mcp-oauth-messages";

export function ChatGptDesktopSetup() {
  const lang = useLang();
  const t = mcpOAuthMessages(lang).desktopBridge;
  const confirm = useConfirm();
  const [status, setStatus] = useState<DesktopMcpStatus | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => { fetchChatGptDesktop().then((value) => { if (alive) setStatus(value); }).catch(() => { if (alive) setError(true); }); };
    load(); window.addEventListener(MCP_CONNECTIONS_CHANGED, load);
    return () => { alive = false; window.removeEventListener(MCP_CONNECTIONS_CHANGED, load); };
  }, []);
  const refresh = async () => { setStatus(await fetchChatGptDesktop()); window.dispatchEvent(new Event(MCP_CONNECTIONS_CHANGED)); };
  const issue = async () => {
    if (status?.active && !await confirm({ title: t.replaceTitle, confirmText: t.replaceConfirm, cancelText: t.cancel, description: t.replaceDescription })) return;
    setBusy(true); setError(false); setCopied(false);
    try { setCommand((await mintChatGptDesktop()).oneLiner); await refresh(); } catch { setError(true); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!await confirm({ title: t.disconnectTitle, confirmText: t.disconnectConfirm, cancelText: t.cancel, description: t.disconnectDescription })) return;
    setBusy(true); setError(false);
    try { await revokeChatGptDesktop(); setCommand(null); await refresh(); } catch { setError(true); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(command!); setCopied(true); } catch { setError(true); } };
  return <section className="space-y-3 rounded-lg border border-line p-3" aria-label={t.ariaLabel}>
    <h3 className="font-medium text-ink">{t.heading}</h3>
    <p className="text-sm text-ink-soft">{t.intro}</p>
    <Button type="button" size="sm" disabled={busy} onClick={issue}>{busy ? t.wait : status?.active ? t.replaceCommand : t.getCommand}</Button>
    {command && <div className="space-y-2">
      <p className="text-xs text-ink-soft">{t.pasteHint}</p>
      <code className="block break-all rounded-lg bg-surface-2 p-2 font-mono text-xs">{command}</code>
      <Button type="button" size="sm" variant="secondary" onClick={copy}>{copied ? t.copied : t.copyCommand}</Button>
      <p className="text-xs text-ink-soft">{t.afterInstall}</p>
    </div>}
    {status?.active && <div className="space-y-2 text-xs text-ink-soft">
      <p>{status.lastSeenAt ? t.lastRequest(new Date(status.lastSeenAt).toLocaleString(lang)) : t.awaitingFirstRequest}</p>
      <p>{t.validity}</p>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={disconnect}>{t.disconnectButton}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{t.actionFailed}</p>}
  </section>;
}
