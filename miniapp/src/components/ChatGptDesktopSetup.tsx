"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { fetchChatGptDesktop, mintChatGptDesktop, revokeChatGptDesktop, type DesktopMcpStatus } from "@/lib/chatgpt-desktop";
import { MCP_CONNECTIONS_CHANGED } from "@/lib/mcp-oauth";

export function ChatGptDesktopSetup() {
  const lang = useLang();
  const text = (ru: string, en: string) => lang === "en" ? en : ru;
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
    if (status?.active && !await confirm({ title: text("Перевыпустить команду ChatGPT?", "Replace the ChatGPT credential?"), confirmText: text("Перевыпустить", "Replace"), cancelText: text("Отмена", "Cancel"), description: text("Предыдущее подключение ChatGPT перестанет работать. Claude и bumblebee продолжат работать.", "The previous ChatGPT credential will stop working. Claude and bumblebee stay connected.") })) return;
    setBusy(true); setError(false); setCopied(false);
    try { setCommand((await mintChatGptDesktop()).oneLiner); await refresh(); } catch { setError(true); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!await confirm({ title: text("Отключить мост ChatGPT?", "Disconnect the ChatGPT bridge?"), confirmText: text("Отключить", "Disconnect"), cancelText: text("Отмена", "Cancel"), description: text("Локальный мост потеряет доступ к Swarm. Claude и веб-подключения останутся активны.", "The local bridge will lose Swarm access. Claude and web connections stay active.") })) return;
    setBusy(true); setError(false);
    try { await revokeChatGptDesktop(); setCommand(null); await refresh(); } catch { setError(true); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(command!); setCopied(true); } catch { setError(true); } };
  return <section className="space-y-3 rounded-lg border border-line p-3" aria-label={text("Мост для настольного ChatGPT", "ChatGPT desktop bridge")}>
    <h3 className="font-medium text-ink">{text("Подключить через Терминал · macOS", "Connect through Terminal · macOS")}</h3>
    <p className="text-sm text-ink-soft">{text("Команда установит мост и добавит SwarmBrain в настройки настольного ChatGPT. Создавать плагин не нужно. Требуется установленное приложение ChatGPT.", "The command installs the bridge and adds SwarmBrain to the ChatGPT desktop settings. No custom plugin is needed. Install the ChatGPT desktop app first.")}</p>
    <Button type="button" size="sm" disabled={busy} onClick={issue}>{busy ? text("Подождите…", "Please wait…") : status?.active ? text("Перевыпустить команду установки", "Replace installation command") : text("Получить команду установки", "Get installation command")}</Button>
    {command && <div className="space-y-2">
      <p className="text-xs text-ink-soft">{text("Откройте Терминал, вставьте строку целиком и нажмите Enter. Команда содержит ваш личный доступ — не пересылайте её.", "Open Terminal, paste the entire command and press Enter. It contains your personal credential; do not share it.")}</p>
      <code className="block break-all rounded-lg bg-surface-2 p-2 font-mono text-xs">{command}</code>
      <Button type="button" size="sm" variant="secondary" onClick={copy}>{copied ? text("Скопировано", "Copied") : text("Скопировать команду", "Copy command")}</Button>
      <p className="text-xs text-ink-soft">{text("После установки полностью закройте и откройте ChatGPT. Проверьте /mcp и попросите SwarmBrain показать, кто вы.", "After installation, quit and reopen ChatGPT. Check /mcp and ask SwarmBrain who you are.")}</p>
    </div>}
    {status?.active && <div className="space-y-2 text-xs text-ink-soft">
      <p>{status.lastSeenAt ? text("Последнее обращение: ", "Last request: ") + new Date(status.lastSeenAt).toLocaleString(lang) : text("Доступ выпущен; ожидается первое обращение из ChatGPT.", "Credential issued; awaiting the first request from ChatGPT.")}</p>
      <p>{text("Доступ действует 30 дней. Claude использует отдельный токен.", "Access lasts 30 days. Claude uses a separate credential.")}</p>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={disconnect}>{text("Отключить мост ChatGPT", "Disconnect ChatGPT bridge")}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{text("Не удалось выполнить действие. Обновите страницу и попробуйте снова.", "The action failed. Refresh the page and try again.")}</p>}
  </section>;
}
