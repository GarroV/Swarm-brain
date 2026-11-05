"use client";
import { useState } from "react";
import { broadcastMessage } from "@/lib/api";
import type { AdminWorkspace } from "@/types";
import { useRoyNav } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { Segmented } from "@/components/roy/ui";
import { canSeeMasterSection } from "@/lib/adminAccess";
import { useSpacesText } from "@/components/admin/spacesText";

// «Рассылка» пространства: сообщение в Telegram людям ЭТОГО пространства. Мастер-админу доступен ещё
// «все пространства» — но по умолчанию выбрано текущее, чтобы случайно не написать всей системе.
// Тексты и состав получателей существующей рассылки не менялись: меняется только охват по выбору.
type Audience = "space" | "all";

export function WorkspaceBroadcast({ ws }: { ws: AdminWorkspace }) {
  const t = useSpacesText();
  const confirm = useConfirm();
  const { me } = useRoyNav();
  const master = canSeeMasterSection(me);
  const [audience, setAudience] = useState<Audience>("space");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const toAll = master && audience === "all";
    const preview = `${body.slice(0, 140)}${body.length > 140 ? "…" : ""}`;
    if (!(await confirm({
      title: toAll ? t("bcConfirmAllTitle") : t("bcConfirmTitle", { name: ws.name }),
      description: t(toAll ? "bcConfirmAllBody" : "bcConfirmBody", { text: preview }),
      confirmText: toAll ? t("bcSendAll") : t("bcSend"),
    }))) return;
    setSending(true); setResult(null);
    try {
      const r = await broadcastMessage(body, toAll ? "all" : ws.id);
      setResult(t(r.failed ? "bcResultFailed" : "bcResult", { sent: r.sent, failed: r.failed, total: r.total }));
      setText("");
    } catch (e) {
      console.error("[WorkspaceBroadcast]", e);
      setResult(t("bcFailed"));
    } finally { setSending(false); }
  };

  return (
    <section className="max-w-[720px] space-y-2">
      <p className="text-ink-mute" style={{ fontSize: 12.5 }}>
        {t(master && audience === "all" ? "bcLeadAll" : "bcLead", { name: ws.name })}
        {me?.name ? ` · ${t("bcSentAs", { name: me.name })}` : ""}
      </p>
      {master && (
        <div className="max-w-[360px]">
          <Segmented
            items={[{ id: "space", label: ws.name }, { id: "all", label: t("bcAudienceAll") }]}
            value={audience}
            onChange={(v) => setAudience(v as Audience)}
          />
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
        placeholder={t("bcPlaceholder")} aria-label={t("bcPlaceholder")}
        className="w-full resize-none rounded-[8px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-mute focus:border-primary"
        style={{ fontSize: 13 }} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={send} disabled={sending || !text.trim()}
          className="inline-flex h-[32px] items-center rounded-full bg-primary px-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          style={{ fontSize: 12.5 }}>
          {sending ? t("bcSending") : master && audience === "all" ? t("bcSendAll") : t("bcSend")}
        </button>
        {result && <span className="font-mono text-ink-soft" role="status" style={{ fontSize: 11.5 }}>{result}</span>}
      </div>
    </section>
  );
}
