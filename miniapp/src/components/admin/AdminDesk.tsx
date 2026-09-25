"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AdminWorkspace } from "@/types";
import { broadcastMessage, fetchReviewCounts, type ReviewCount } from "@/lib/api";
import { AdminScreen, WorkspaceDetail, WorkspaceList } from "@/components/AdminScreen";
import { useConfirm } from "@/components/ui/confirm";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";

// «Админ» десктопа по стенду (docs/redesign/stand/js/screens-system.js → screenAdmin): вкладки
// Воркспейсы · Очередь вычитки · Рассылка вместо стопки сворачиваемых блоков. Воркспейсы —
// прежние WorkspaceList/WorkspaceDetail (пользователи и рынки внутри воркспейса). Вкладок
// стенда «Пользователи» (все люди разом), «Встречи от агента» и «Фидбек» здесь нет: людей
// продукт показывает по воркспейсу, черновики агента разбираются на экране «Встречи», списка
// фидбека в вебе нет (он приходит админу в Telegram).

type Tab = "ws" | "review" | "broadcast";
const TABS: [Tab, string, string][] = [
  ["ws", "Воркспейсы", "Workspaces"], ["review", "Очередь вычитки", "Review queue"], ["broadcast", "Рассылка", "Broadcast"],
];

/** Маршрут «Админ»: на десктопе — вкладки по стенду, на мобайле — прежний экран. */
export function AdminRoute() {
  return useIsDesktop() ? <AdminDesk /> : <AdminScreen />;
}

function AdminDesk() {
  const dt = useDt();
  const [tab, setTab] = useState<Tab>("ws");
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);
  const [reviews, setReviews] = useState<ReviewCount[] | null>(null);

  useEffect(() => {
    fetchReviewCounts().then(setReviews).catch((e) => { console.error("[AdminDesk] review counts", e); setReviews([]); });
  }, []);
  const queued = (reviews ?? []).reduce((n, r) => n + r.count, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div role="tablist" className="flex shrink-0 items-end gap-5 overflow-x-auto border-b border-line px-5" style={{ height: 40 }}>
        {TABS.map(([id, ru, en]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            onClick={() => { setTab(id); if (id === "ws") setSelected(null); }}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 font-medium transition-colors",
              tab === id ? "border-primary font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink",
            )}
            style={{ fontSize: 13 }}>
            {dt(ru, en)}
            {id === "review" && queued > 0 && <span className="text-ink-mute" style={{ fontSize: 11 }}>{queued}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tab === "ws" && (selected
          ? <WorkspaceDetail ws={selected} onBack={() => setSelected(null)} desk />
          : <div className="p-4"><WorkspaceList onSelect={setSelected} /></div>)}
        {tab === "review" && <ReviewTable rows={reviews} total={queued} />}
        {tab === "broadcast" && <Broadcast />}
      </div>
    </div>
  );
}

const REVIEW_COLS = "minmax(0,1fr) 140px";

function ReviewTable({ rows, total }: { rows: ReviewCount[] | null; total: number }) {
  const dt = useDt();
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2" style={{ fontSize: 12.5 }}>
        <span className="text-ink-mute">{dt("Только число — сами встречи приватны их владельцу", "Counts only — the meetings stay private to their owners")}</span>
        <span className="ml-auto whitespace-nowrap text-ink-mute">{dt("На вычитке", "In review")} <b className="text-ink">{total}</b></span>
      </div>
      <div className="p-4">
        {rows == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim mb-1.5" style={{ height: 34, borderRadius: 8 }} />)}
        {rows != null && rows.length === 0 && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Ни у кого нет встреч на вычитке", "Nobody has meetings waiting for review")}
          </div>
        )}
        {rows != null && rows.length > 0 && (
          <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface" style={{ fontSize: 13 }}>
            <div role="row" className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
              style={{ gridTemplateColumns: REVIEW_COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
              <span className="px-3">{dt("Участник", "Member")}</span>
              <span className="px-3 text-right">{dt("На вычитке", "In review")}</span>
            </div>
            {rows.map((r) => (
              <div key={r.telegram_id} role="row" className="grid items-center border-b border-line last:border-b-0"
                style={{ gridTemplateColumns: REVIEW_COLS, minHeight: 36 }}>
                <span className="truncate px-3 font-medium text-ink">{r.name}</span>
                <span className="px-3 text-right font-mono font-semibold text-accent-ink" style={{ fontSize: 12.5 }}>{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Broadcast() {
  const dt = useDt();
  const confirm = useConfirm();
  const { me } = useRoyNav();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const preview = `${t.slice(0, 140)}${t.length > 140 ? "…" : ""}`;
    if (!(await confirm({
      title: dt("Отправить сообщение всем пользователям?", "Send the message to every user?"),
      description: dt(`Сообщение уйдёт в Telegram каждому пользователю системы:\n\n«${preview}»`, `The message goes to every user in Telegram:\n\n“${preview}”`),
      confirmText: dt("Отправить всем", "Send to all"),
    }))) return;
    setSending(true);
    setResult(null);
    try {
      const r = await broadcastMessage(t);
      setResult(dt(`Отправлено: ${r.sent}${r.failed ? ` · не доставлено: ${r.failed}` : ""} (из ${r.total})`,
        `Sent: ${r.sent}${r.failed ? ` · not delivered: ${r.failed}` : ""} (of ${r.total})`));
      setText("");
    } catch (e) {
      console.error("[AdminDesk] broadcast", e);
      setResult(e instanceof Error ? e.message : dt("Ошибка рассылки", "Broadcast failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4">
      <section className="max-w-[720px] rounded-[12px] border border-line bg-surface px-4 py-4">
        <h3 className="font-semibold text-ink" style={{ fontSize: 15 }}>{dt("Рассылка всем", "Broadcast to all")}</h3>
        <p className="mb-3 mt-0.5 text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Уходит в Telegram каждому пользователю системы", "Goes to every user of the system in Telegram")}
          {me?.name ? dt(` · от имени ${me.name}`, ` · sent as ${me.name}`) : ""}
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder={dt("Сообщение всем пользователям системы…", "A message to every user…")}
          className="w-full resize-none rounded-[8px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-mute focus:border-primary"
          style={{ fontSize: 13 }} />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={send} disabled={sending || !text.trim()}
            className="inline-flex h-[32px] items-center rounded-[7px] bg-primary px-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            style={{ fontSize: 12.5 }}>
            {sending ? dt("Отправляю…", "Sending…") : dt("Отправить всем", "Send to all")}
          </button>
          {result && <span className="font-mono text-ink-soft" style={{ fontSize: 11.5 }}>{result}</span>}
        </div>
      </section>
    </div>
  );
}
