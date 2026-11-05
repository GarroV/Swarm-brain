"use client";
import { useState } from "react";
import { broadcastMessage } from "@/lib/api";
import type { AdminWorkspace } from "@/types";
import { useRoyNav } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { canSeeMasterSection } from "@/lib/adminAccess";
import { useSpacesText } from "@/components/admin/spacesText";

// «Рассылка»: сообщение в Telegram людям пространств, которые отправитель ВЫБРАЛ. Мастер-админ
// отмечает любые пространства; заранее отмечено только то, чья карточка открыта, «всех сразу» нет, и
// без хотя бы одного отмеченного отправить нельзя. Админ пространства выбора не видит: пишет только
// своему. Тексты и логика доставки каждому человеку не менялись — меняется только охват.
export function WorkspaceBroadcast({ ws, allWorkspaces }: { ws: AdminWorkspace; allWorkspaces: AdminWorkspace[] }) {
  const t = useSpacesText();
  const confirm = useConfirm();
  const { me } = useRoyNav();
  const master = canSeeMasterSection(me);
  const choices = allWorkspaces.some((w) => w.id === ws.id) ? allWorkspaces : [ws, ...allWorkspaces];
  const [picked, setPicked] = useState<string[]>([ws.id]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const targets = master ? picked : [ws.id];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async () => {
    const body = text.trim();
    if (!body || targets.length === 0) return;
    const names = choices.filter((w) => targets.includes(w.id)).map((w) => w.name).join(", ");
    const preview = `${body.slice(0, 140)}${body.length > 140 ? "…" : ""}`;
    if (!(await confirm({
      title: t("bcConfirmTitle", { names }),
      description: t("bcConfirmBody", { text: preview }),
      confirmText: t("bcSend"),
    }))) return;
    setSending(true); setResult(null);
    try {
      const r = await broadcastMessage(body, targets);
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
        {master ? t("bcLead") : t("bcLeadOwn", { name: ws.name })}
        {me?.name ? ` · ${t("bcSentAs", { name: me.name })}` : ""}
      </p>
      {master && (
        <fieldset className="space-y-1">
          <legend className="mb-1 font-semibold text-ink" style={{ fontSize: 12.5 }}>{t("bcPick")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {choices.map((w) => (
              <label key={w.id} className="inline-flex cursor-pointer items-center gap-1.5 text-ink" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={picked.includes(w.id)} onChange={() => toggle(w.id)} className="accent-[var(--accent-ink)]" />
                <span>{w.name}</span>
              </label>
            ))}
          </div>
          {targets.length === 0 && <p role="status" className="text-ink-mute" style={{ fontSize: 12 }}>{t("bcNeedOne")}</p>}
        </fieldset>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
        placeholder={t("bcPlaceholder")} aria-label={t("bcPlaceholder")}
        className="w-full resize-none rounded-[8px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-mute focus:border-primary"
        style={{ fontSize: 13 }} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={send} disabled={sending || !text.trim() || targets.length === 0}
          className="inline-flex h-[32px] items-center rounded-full bg-primary px-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          style={{ fontSize: 12.5 }}>
          {sending ? t("bcSending") : t("bcSend")}
        </button>
        {result && <span className="font-mono text-ink-soft" role="status" style={{ fontSize: 11.5 }}>{result}</span>}
      </div>
    </section>
  );
}
